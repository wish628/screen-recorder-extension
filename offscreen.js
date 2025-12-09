// Offscreen document for handling recording
// This runs in a hidden document context with access to navigator.mediaDevices

console.log('Offscreen document loaded');

let recorder = null;
let chunks = [];
let activeStream = null;
let micStream = null;

// Get supported MIME type
function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp8,vorbis',
        'video/webm'
    ];

    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            console.log('Using MIME type:', type);
            return type;
        }
    }

    return '';
}

// Cleanup function
function cleanup() {
    console.log('Cleaning up...');

    if (recorder && recorder.state !== 'inactive') {
        try {
            recorder.stop();
        } catch (e) {
            console.log('Error stopping recorder:', e);
        }
    }

    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
    }

    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
    }

    recorder = null;
    chunks = [];
    activeStream = null;
    micStream = null;
}

// Start recording with provided stream ID
async function startRecording(streamId) {
    console.log('=== START RECORDING IN OFFSCREEN ===');
    console.log('Stream ID:', streamId);

    try {
        cleanup();

        // Get screen stream
        console.log('Getting screen stream...');
        const screenConstraints = {
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId,
                    maxWidth: 1920,
                    maxHeight: 1080,
                    maxFrameRate: 30
                }
            },
            audio: false
        };

        activeStream = await navigator.mediaDevices.getUserMedia(screenConstraints);
        console.log('Screen stream acquired:', activeStream.getVideoTracks().length, 'video tracks');

        // Get microphone (optional)
        console.log('Requesting microphone...');
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            console.log('Microphone acquired:', micStream.getAudioTracks().length, 'audio tracks');
        } catch (e) {
            console.log('Microphone denied:', e.message);
            micStream = null;
        }

        // Merge streams
        let finalStream;
        if (micStream && micStream.getAudioTracks().length > 0) {
            console.log('Merging audio...');
            const audioCtx = new AudioContext();
            const dest = audioCtx.createMediaStreamDestination();
            const micSource = audioCtx.createMediaStreamSource(micStream);
            micSource.connect(dest);

            finalStream = new MediaStream([
                ...activeStream.getVideoTracks(),
                ...dest.stream.getAudioTracks()
            ]);
            console.log('Audio merged. Total tracks:', finalStream.getTracks().length);
        } else {
            console.log('Using video-only stream');
            finalStream = activeStream;
        }

        // Create recorder
        const mimeType = getSupportedMimeType();
        chunks = [];
        recorder = new MediaRecorder(finalStream, mimeType ? { mimeType } : {});

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                chunks.push(e.data);
                console.log('Chunk received:', e.data.size, 'bytes. Total:', chunks.length);
            }
        };

        recorder.onstop = () => {
            console.log('=== RECORDER STOPPED ===');
            console.log('Total chunks:', chunks.length);

            // Stop all tracks
            if (activeStream) activeStream.getTracks().forEach(t => t.stop());
            if (micStream) micStream.getTracks().forEach(t => t.stop());

            if (chunks.length === 0) {
                console.error('No data recorded');
                chrome.runtime.sendMessage({
                    type: 'recording-error',
                    error: 'No data captured'
                });
                return;
            }

            // Create blob
            const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
            console.log('Blob created:', blob.size, 'bytes');

            if (blob.size === 0) {
                console.error('Empty blob');
                chrome.runtime.sendMessage({
                    type: 'recording-error',
                    error: 'Empty file'
                });
                return;
            }

            // Send blob to background for download
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result;
                chrome.runtime.sendMessage({
                    type: 'recording-complete',
                    data: base64data,
                    mimeType: mimeType || 'video/webm'
                });
            };
            reader.readAsDataURL(blob);
        };

        recorder.onerror = (e) => {
            console.error('Recorder error:', e);
            chrome.runtime.sendMessage({
                type: 'recording-error',
                error: 'Recording error: ' + e.error
            });
            cleanup();
        };

        // Start recording
        recorder.start(1000);
        console.log('Recording started');

        chrome.runtime.sendMessage({ type: 'recording-started' });

    } catch (error) {
        console.error('Error starting recording:', error);
        chrome.runtime.sendMessage({
            type: 'recording-error',
            error: error.message
        });
        cleanup();
    }
}

// Stop recording
function stopRecording() {
    console.log('=== STOP RECORDING ===');

    if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
    } else {
        console.log('Recorder not active');
        chrome.runtime.sendMessage({
            type: 'recording-error',
            error: 'Not recording'
        });
    }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('Offscreen received message:', msg);

    if (msg.type === 'start-recording') {
        startRecording(msg.streamId)
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === 'stop-recording') {
        stopRecording();
        sendResponse({ ok: true });
        return true;
    }

    return false;
});

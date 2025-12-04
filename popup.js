let recorder, chunks = [];

document.getElementById('rec').onclick = () => {
  startRecording();
};

document.getElementById('stop').onclick = () => {
  stopRecording();
};

// Add a cleanup function
function cleanupPreviousRecording() {
  console.log('Cleaning up previous recording...');
  // Stop any existing recorder
  if (recorder) {
    try {
      console.log('Current recorder state:', recorder.state);
      if (recorder.state !== 'inactive') {
        recorder.stop();
        console.log('Recorder stopped');
      }
    } catch (e) {
      console.log('Error stopping recorder:', e);
    }
    
    // Stop all tracks
    if (recorder.stream) {
      try {
        recorder.stream.getTracks().forEach(track => {
          try {
            console.log('Stopping track:', track.kind);
            track.stop();
          } catch (e) {
            console.log('Error stopping track:', e);
          }
        });
      } catch (e) {
        console.log('Error stopping streams:', e);
      }
    }
  }
  
  // Clear variables
  recorder = null;
  chunks = [];
  console.log('Cleanup complete');
}

async function startRecording() {
  try {
    console.log('=== STARTING RECORDING PROCESS ===');
    
    // Always cleanup first
    cleanupPreviousRecording();
    
    // Check if tabCapture API is available
    if (!chrome.tabCapture) {
      throw new Error('tabCapture API not available in this context');
    }
    
    // Disable the record button and enable stop button
    document.getElementById('rec').disabled = true;
    document.getElementById('stop').disabled = false;
    console.log('UI buttons updated');
    
    // First, get active tab info
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    console.log('Active tab:', tab);
    
    // Try to cancel any existing capture
    console.log('Attempting to cancel any existing capture...');
    try {
      // This is a workaround to cancel existing captures
      chrome.tabCapture.capture({
        audio: false,
        video: false
      }, (nullStream) => {
        console.log('Cleanup capture attempt result:', nullStream);
      });
    } catch (cleanupError) {
      console.log('Cleanup capture attempt error:', cleanupError);
    }
    
    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('Requesting new tab capture...');
    // Ask for tab capture permission
    const tabStream = await new Promise((resolve, reject) => {
      console.log('Calling chrome.tabCapture.capture...');
      chrome.tabCapture.capture(
        {
          audio: true,
          video: true
        },
        (stream) => {
          console.log('=== TABCAPTURE CALLBACK EXECUTED ===');
          console.log('Stream received:', stream);
          console.log('Last error:', chrome.runtime.lastError);
          
          if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError);
            reject(new Error(`Permission error: ${chrome.runtime.lastError.message}`));
          } else if (!stream) {
            console.error('No stream returned');
            reject(new Error('No stream returned from tabCapture - permission likely denied'));
          } else {
            console.log('Successfully received stream with tracks:', stream.getTracks());
            resolve(stream);
          }
        }
      );
    });

    console.log('Tab stream captured successfully:', tabStream);

    console.log('Requesting microphone access...');
    // Ask for microphone permission
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('Microphone stream captured successfully:', micStream);

    console.log('Merging audio streams...');
    // Merge audio streams
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    
    let trackCount = 0;
    if (tabStream.getAudioTracks().length > 0) {
      const tabAudioSource = audioCtx.createMediaStreamSource(tabStream);
      tabAudioSource.connect(dest);
      trackCount += tabStream.getAudioTracks().length;
      console.log('Connected tab audio tracks:', tabStream.getAudioTracks().length);
    }
    
    if (micStream.getAudioTracks().length > 0) {
      const micAudioSource = audioCtx.createMediaStreamSource(micStream);
      micAudioSource.connect(dest);
      trackCount += micStream.getAudioTracks().length;
      console.log('Connected microphone audio tracks:', micStream.getAudioTracks().length);
    }
    
    console.log('Total audio tracks connected:', trackCount);

    // Create final stream with video from tab and merged audio
    const videoTracks = tabStream.getVideoTracks();
    const audioTracks = dest.stream.getAudioTracks();
    
    console.log('Video tracks:', videoTracks.length);
    console.log('Merged audio tracks:', audioTracks.length);
    
    const mixedStream = new MediaStream([
      ...videoTracks,
      ...audioTracks
    ]);

    console.log('Mixed stream created with total tracks:', mixedStream.getTracks().length);

    console.log('Initializing MediaRecorder...');
    // Start recording
    recorder = new MediaRecorder(mixedStream, { mimeType: 'video/webm' });
    chunks = [];
    
    console.log('MediaRecorder state:', recorder.state);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
        console.log('Chunk received, size:', event.data.size, 'bytes. Total chunks:', chunks.length);
      } else {
        console.log('Empty chunk received');
      }
    };

    recorder.onstop = () => {
      console.log('=== RECORDER STOPPED ===');
      console.log('Total chunks collected:', chunks.length);
      
      if (chunks.length > 0 && chunks.reduce((total, chunk) => total + chunk.size, 0) > 0) {
        const blob = new Blob(chunks, { type: 'video/webm' });
        console.log('Blob created, size:', blob.size, 'bytes');
        
        if (blob.size > 0) {
          // Create download link that stays open for user interaction
          const url = URL.createObjectURL(blob);
          const filename = `recording-${Date.now()}.webm`;
          console.log('Creating download link for file:', filename);
          
          // Create a prominent download link in the popup
          const downloadContainer = document.createElement('div');
          downloadContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            background: #4CAF50;
            color: white;
            padding: 10px;
            text-align: center;
            z-index: 10000;
            font-family: Arial, sans-serif;
          `;
          
          downloadContainer.innerHTML = `
            <strong>Recording Complete!</strong><br>
            <a href="${url}" download="${filename}" 
               style="color: white; font-weight: bold; text-decoration: underline;">
              Click here to download: ${filename}
            </a><br>
            <small>(Right-click and select "Save link as..." to choose location)</small>
          `;
          
          document.body.appendChild(downloadContainer);
          
          // Also show alert to notify user
          alert('Recording complete!\n\n' +
                'A download link has appeared at the top of this popup.\n' +
                'Click it or right-click to save to your preferred location.');
          
          console.log('Download link created for user interaction');
        } else {
          console.warn('Blob is empty, not creating download link');
          alert('Recording completed but file is empty. No data was captured.');
        }
      } else {
        console.warn('No data recorded or chunks are empty');
        alert('Recording completed but no data was captured.');
      }
      
      // Cleanup after recording (but keep the download link)
      // Don't cleanup immediately, let user interact with download link first
      setTimeout(() => {
        cleanupPreviousRecording();
      }, 30000); // Cleanup after 30 seconds
      
      // Don't close the popup automatically
      // Let user close it manually after downloading
    };

    recorder.start(1000); // Collect data every second
    console.log('Recording started with timeslice: 1000ms');
    console.log('Recorder state after start:', recorder.state);
    
  } catch (error) {
    console.error('=== ERROR STARTING RECORDING ===');
    console.error('Error starting recording:', error);
    
    // Cleanup on error
    cleanupPreviousRecording();
    
    alert('Error starting recording: ' + error.message + '\n\n' +
          'Check the console (Ctrl+Shift+J) for detailed error information.\n\n' +
          'Common issues:\n' +
          '- Permissions not granted\n' +
          '- Trying to record restricted pages\n' +
          '- No audio/video content in tab\n' +
          '- Browser policies blocking capture');
    
    // Re-enable record button
    document.getElementById('rec').disabled = false;
    document.getElementById('stop').disabled = true;
  }
}

function stopRecording() {
  console.log('=== STOPPING RECORDING ===');
  
  if (recorder && recorder.state !== 'inactive') {
    console.log('Stopping recorder...');
    recorder.stop();
    console.log('Recorder stop command sent');
    
    // Show message that processing is happening
    const processingMsg = document.createElement('div');
    processingMsg.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #2196F3;
      color: white;
      padding: 20px;
      border-radius: 5px;
      z-index: 10001;
      font-family: Arial, sans-serif;
      text-align: center;
    `;
    processingMsg.innerHTML = '<strong>Processing recording...</strong><br>Please wait';
    document.body.appendChild(processingMsg);
    
    // Remove processing message after a few seconds
    setTimeout(() => {
      if (processingMsg.parentNode) {
        processingMsg.parentNode.removeChild(processingMsg);
      }
    }, 3000);
  } else {
    console.log('Recorder not active or not initialized');
  }
  
  // Don't cleanup immediately when stopping
  // The onstop handler will handle cleanup
  
  // Re-enable record button
  document.getElementById('rec').disabled = false;
  document.getElementById('stop').disabled = true;
  console.log('UI buttons reset');
}
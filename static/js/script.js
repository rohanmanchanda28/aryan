// --- IMPORTANT SECURITY WARNING --- 
// For this MVP, we are embedding the API key directly in the browser code.
// **DO NOT DO THIS IN PRODUCTION.** Your API key will be exposed.
// In a real application, use a backend server to securely handle the API key
// and either proxy the connection or generate ephemeral tokens.
const OPENAI_API_KEY = "xxxxx"; // <<<< Placeholder - Key removed for safety

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const statusMessageElement = document.getElementById('status-message');
    const toggleButton = document.getElementById('toggle-interview-button');
    const transcriptTextElement = document.getElementById('transcript-text'); // For debug
    const transcriptArea = document.querySelector('.transcript-area'); // To show/hide

    // --- State Variables ---
    let ws = null;
    let audioContext = null;
    let processor = null;
    let microphoneSource = null;
    let streamReference = null;
    let audioQueue = []; // Queue for incoming audio chunks
    let isPlaying = false;
    let isInterviewActive = false;
    let connectionAttempts = 0;
    const MAX_CONNECTION_ATTEMPTS = 3;

    // --- Configuration ---
    // Matches the API requirements for pcm16
    const TARGET_SAMPLE_RATE = 24000;
    const TARGET_CHANNELS = 1; // Mono
    // Try simplifying the endpoint - remove audio formats initially
    const REALTIME_ENDPOINT = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview&voice=alloy"; 
    // const REALTIME_ENDPOINT = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview&voice=alloy&output_audio_format=pcm16&input_audio_format=pcm16"; // Original
    // Note: Model, voice, formats are set in URL - could be configurable via session.update later

    const errorMessages = {
        micFail: "Mic check... nope! Permissions okay? Plugged in? Shy? 🤔",
        wsOpenFail: "Whoops! Couldn't connect to the AI brain. Check the key/network? 🧠",
        wsError: "Uh oh! Communication hiccup with the AI. 😵‍💫",
        wsClosed: "Connection closed. Was it something I said? 🤔",
        audioContextFail: "Sound waves acting up! Couldn't initialize audio. Needs browser magic? 🪄",
        playbackError: "Playback glitch! Couldn't play the AI's response. 🔇",
        apiKeyMissing: "Hold on! Your OpenAI API key is missing in the script. Add it first! 🔑"
    };

    // --- Helper Functions ---
    function updateStatus(message, isError = false) {
        statusMessageElement.textContent = message;
        statusMessageElement.style.color = isError ? '#dc3545' : '#666';
        console.log(isError ? `Error: ${message}` : `Status: ${message}`);
        if (isError) console.error(message);
    }

    function base64Encode(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
        if (inputSampleRate === outputSampleRate) {
            return buffer;
        }
        const sampleRateRatio = inputSampleRate / outputSampleRate;
        const newLength = Math.round(buffer.length / sampleRateRatio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
            let accum = 0, count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                accum += buffer[i];
                count++;
            }
            result[offsetResult] = accum / count;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    }

    function floatTo16BitPCM(output, input) {
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }

     // --- Audio Playback --- 
    async function playNextAudioChunk() {
        if (isPlaying || audioQueue.length === 0) {
            return; // Already playing or nothing to play
        }
        isPlaying = true;

        const base64Audio = audioQueue.shift(); 
        try {
            // 1. Decode Base64
            const audioBytes = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
            const pcm16Data = new Int16Array(audioBytes.buffer);

            // 2. Convert 16-bit PCM to Float32 for Web Audio API
            const float32Data = new Float32Array(pcm16Data.length);
            for (let i = 0; i < pcm16Data.length; i++) {
                float32Data[i] = pcm16Data[i] / 32768.0; // Convert to range -1.0 to 1.0
            }

            // 3. Create AudioBuffer
             if (!audioContext) { // Ensure audio context is available
                console.warn("Audio context not available for playback.");
                 isPlaying = false;
                 return;
             }
            const audioBuffer = audioContext.createBuffer(TARGET_CHANNELS, float32Data.length, TARGET_SAMPLE_RATE);
            audioBuffer.copyToChannel(float32Data, 0);

            // 4. Play buffer
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.onended = () => {
                // console.log("Audio chunk finished playing.");
                isPlaying = false;
                playNextAudioChunk(); // Check if more chunks are waiting
            };
            source.start();
            // console.log("Playing audio chunk...");

        } catch (error) {
            console.error("Error playing audio chunk:", error);
            updateStatus(errorMessages.playbackError, true);
            isPlaying = false;
            // Maybe clear the queue or try next chunk?
            // For now, just stop playback on error.
            audioQueue = []; // Clear queue on error
        }
    }

    // --- WebSocket Handling ---
    function connectWebSocket() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            console.log("WebSocket already open or connecting.");
            return;
        }
        
        if (!OPENAI_API_KEY || OPENAI_API_KEY === "YOUR_OPENAI_API_KEY_HERE") {
             updateStatus(errorMessages.apiKeyMissing, true);
             toggleButton.textContent = "Start Interview";
             toggleButton.classList.remove('active');
             isInterviewActive = false;
             return;
        }

        updateStatus("Connecting to AI...");
        connectionAttempts++;

        // Construct headers for WebSocket protocol
        // Note: Standard WebSocket API in browser doesn't support custom headers directly.
        // This direct connection relies on the URL parameters and potentially origin checks, OR
        // it might only work via specific SDKs that handle authentication differently.
        // If this fails, we need the backend token generation approach.
        const headers = [
            `Authorization: Bearer ${OPENAI_API_KEY}`,
            `OpenAI-Beta: realtime=v1`
        ];
        // The JS WebSocket constructor doesn't accept headers like the Python example.
        // We pass parameters via URL and rely on the API key being implicitly handled or validated.
        ws = new WebSocket(REALTIME_ENDPOINT); // `headers` cannot be passed here

        ws.onopen = () => {
            console.log("WebSocket connection established.");
            updateStatus("Connected! Waiting for you to speak...");
            connectionAttempts = 0; // Reset on successful connection
            // No need to send initial message unless API requires it.
            // --- DELAY AUDIO START TO TEST CONNECTION STABILITY ---
            console.log("Delaying audio start for testing...");
            // startAudioProcessing(); // <<< Temporarily commented out
            // Let's start it manually after a short delay or upon receiving a specific event if needed
            // setTimeout(startAudioProcessing, 1000); // Example: Start after 1 second
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                // console.log("WS Received:", message.type);
                
                switch (message.type) {
                    case 'session.created': // Or similar initial event
                        console.log("Session confirmed by server:", message.session);
                        break;
                    case 'response.audio.delta':
                        if (message.delta) {
                           audioQueue.push(message.delta); // Add base64 chunk to queue
                           if (!isPlaying) {
                               playNextAudioChunk(); // Start playback if not already playing
                           }
                        }
                        break;
                    case 'response.audio_transcript.delta':
                         if (message.delta && transcriptArea.style.display !== 'none') {
                            transcriptTextElement.textContent += message.delta;
                         }
                        break;
                    case 'input_audio_buffer.speech_started':
                        updateStatus("Listening...");
                         if (transcriptArea.style.display !== 'none') transcriptTextElement.textContent = ""; // Clear debug transcript
                        break;
                    case 'input_audio_buffer.speech_stopped':
                        updateStatus("Processing your speech...");
                        break;
                     case 'response.done':
                         console.log("AI response complete.");
                         // Potentially add a small delay or check queue before updating status
                         // updateStatus("Ready for you to speak...");
                         break;
                    case 'error':
                        console.error("WebSocket error event:", message.error);
                        updateStatus(`${errorMessages.wsError} (${message.error.code || 'Unknown'})`, true);
                        // Consider closing connection on certain errors
                        break;
                    // Add handlers for other relevant events from the API docs
                    // e.g., response.text.delta, response.done, conversation.item.created etc.
                    default:
                       // console.log("Unhandled WS message type:", message.type);
                       break;
                }
            } catch (error) {
                console.error("Error parsing WebSocket message:", error);
            }
        };

        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            updateStatus(errorMessages.wsError, true);
            // Attempt to reconnect with backoff?
             stopInterview(); // Stop everything on error for now
        };

        ws.onclose = (event) => {
            console.log("WebSocket connection closed:", event.code, event.reason);
            if (isInterviewActive) { // Only show error if unexpected close
                 updateStatus(errorMessages.wsClosed + (event.reason ? ` (${event.reason})` : ''), !event.wasClean);
                 stopInterview(); // Ensure cleanup
            }
        };
    }

    function closeWebSocket() {
        if (ws) {
            console.log("Closing WebSocket connection.");
            ws.close();
            ws = null;
        }
    }

    // --- Audio Input Processing ---
    async function startAudioProcessing() {
        if (!streamReference) { // Get microphone stream only if needed
            try {
                streamReference = await navigator.mediaDevices.getUserMedia({ audio: true });
                console.log("Microphone access granted.");
            } catch (err) {
                console.error("Error accessing microphone:", err);
                updateStatus(errorMessages.micFail, true);
                stopInterview(); // Stop if mic fails
                return;
            }
        }

        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                 // Resume context if needed (user interaction gesture)
                if (audioContext.state === 'suspended') {
                     await audioContext.resume();
                }
                console.log(`AudioContext sample rate: ${audioContext.sampleRate}Hz`);
            } catch (e) {
                 console.error("Error creating AudioContext:", e);
                 updateStatus(errorMessages.audioContextFail, true);
                 stopInterview();
                 return;
            }
        }

        microphoneSource = audioContext.createMediaStreamSource(streamReference);
        processor = audioContext.createScriptProcessor(4096, TARGET_CHANNELS, TARGET_CHANNELS); // Use buffer size that allows frequent sending

        processor.onaudioprocess = (e) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return; // Only process if WS is open

            const inputData = e.inputBuffer.getChannelData(0);
            // Downsample if necessary (browser native rate -> TARGET_SAMPLE_RATE)
            const downsampledData = downsampleBuffer(inputData, audioContext.sampleRate, TARGET_SAMPLE_RATE);
            
            // Convert to 16-bit PCM
            const pcm16Data = new DataView(new ArrayBuffer(downsampledData.length * 2));
            floatTo16BitPCM(pcm16Data, downsampledData);

            // Base64 Encode
            const base64EncodedData = base64Encode(pcm16Data.buffer);

            // Send over WebSocket
            try {
                ws.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: base64EncodedData
                }));
            } catch (err) {
                 console.error("WebSocket send error:", err);
                 // Handle potential WS closure during send
            }
        };

        microphoneSource.connect(processor);
        processor.connect(audioContext.destination); // Connect to destination to keep processing active
        console.log("Audio processing pipeline started.");
        isRecording = true; // Technically, we are always processing when active
    }

    function stopAudioProcessing() {
        console.log("Stopping audio processing pipeline.");
         isRecording = false;
         if (processor) {
             try { processor.disconnect(); } catch(e) {}
             processor.onaudioprocess = null;
             processor = null;
         }
         if (microphoneSource) {
             try { microphoneSource.disconnect(); } catch(e) {}
             microphoneSource = null;
         }
         if (streamReference) {
            streamReference.getTracks().forEach(track => track.stop());
            streamReference = null;
            console.log("Microphone stream stopped.");
        }
         // Don't close audioContext here, it might be needed for playback
    }

    // --- Interview Control ---
    function startInterview() {
        if (isInterviewActive) return;
        console.log("Starting interview...");
        isInterviewActive = true;
        toggleButton.textContent = "Stop Interview";
        toggleButton.classList.add('active');
        // transcriptArea.style.display = 'block'; // Show debug transcript area
        connectWebSocket();
    }

    function stopInterview() {
        if (!isInterviewActive) return;
        console.log("Stopping interview...");
        isInterviewActive = false;
        toggleButton.textContent = "Start Interview";
        toggleButton.classList.remove('active');
        updateStatus("Interview ended.");

        stopAudioProcessing();
        closeWebSocket();
        audioQueue = []; // Clear any pending playback
        isPlaying = false;
        connectionAttempts = 0;

        // Close audio context fully when interview stops
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().then(() => console.log("AudioContext closed."));
            audioContext = null;
        }
    }

    // --- Event Listeners ---
    toggleButton.addEventListener('click', () => {
        if (isInterviewActive) {
            stopInterview();
        } else {
            // Ensure AudioContext can be resumed by user gesture if needed
            if (!audioContext || audioContext.state === 'suspended') {
                 const tempContext = new (window.AudioContext || window.webkitAudioContext)();
                 tempContext.resume().then(() => {
                    console.log("AudioContext resumed by user gesture.");
                    tempContext.close();
                    startInterview(); // Now start the actual interview
                 }).catch(e => {
                     console.error("Failed to resume AudioContext:", e);
                     updateStatus("Could not initialize audio. Please allow microphone access or refresh.", true);
                 });
            } else {
                 startInterview();
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        console.log("Page unloading. Cleaning up...");
        stopInterview(); // Ensure cleanup on page leave
    });

    // --- Initial State ---
    updateStatus("Click \"Start Interview\" to begin.");

});

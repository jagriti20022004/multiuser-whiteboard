document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired! Script is running.'); 

    // Get room info from URL (optional)
    const urlParams = new URLSearchParams(window.location.search);
    const pathParts = window.location.pathname.split('/');
    const roomId = pathParts[pathParts.length - 1];
    const userName = urlParams.get('user');
    
    // Room functionality is optional - if no room params, run as standalone whiteboard
    let currentRoom = null;
    let currentUser = null;
    let isRoomMode = false;
    
    if (roomId && userName) {
        currentRoom = roomId;
        currentUser = userName;
        isRoomMode = true;
        console.log('Running in room mode:', currentRoom, currentUser);
        
        // Show room header in room mode
        const roomHeader = document.getElementById('roomHeader');
        if (roomHeader) {
            roomHeader.style.display = 'block';
        }
    } else {
        console.log('Running in standalone mode');
    }

    // Firebase Global Variables (Replace with your actual Firebase project config)
    const firebaseConfig = {
        apiKey: "AIzaSyCepl5sCsUVhQu6H5tPFIqaK_FNWZ0JNk8",
        authDomain: "mars240324.firebaseapp.com",
        projectId: "mars240324",
        storageBucket: "mars240324.firebasestorage.app",
        messagingSenderId: "827671172907",
        appId: "1:827671172907:web:ac8ee8ffce5a6660b4176e",
        measurementId: "G-8NJQ701YKJ"
    };
    const appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.appId;

    // Initialize Firebase
    const app = firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore(); 
    const auth = firebase.auth();
    let userId = null; 

    // Initialize room display (only if in room mode)
    async function initializeRoomDisplay() {
        if (!isRoomMode) return;
        
        try {
            const response = await fetch(`/api/rooms/${currentRoom}`);
            const roomData = await response.json();
            
            document.getElementById('roomName').textContent = `Room: ${roomData.name}`;
            document.getElementById('roomParticipants').textContent = `Participants: ${roomData.participants.join(', ')}`;
        } catch (error) {
            console.error('Error loading room data:', error);
        }
    }

    // Function to authenticate the user and start the Firestore listener
    async function authenticateAndLoad() {
        try {
            await auth.signInAnonymously();
            userId = auth.currentUser.uid;
            console.log("Firebase authenticated. User ID:", userId);
            
            // The listener will now handle loading the history and all subsequent updates.
            setupFirestoreListener();

            // Perform initial canvas sizing.
            resizeCanvas();

        } catch (error) {
            console.error("Firebase authentication failed:", error);
            userId = crypto.randomUUID(); // Fallback
            resizeCanvas(); // Still size the canvas on failure
        }
    }

    // --- WebSocket Connection ---
    let ws = null;
    
    if (isRoomMode) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            // Join the room via WebSocket
            ws.send(JSON.stringify({
                type: 'join_room',
                roomId: currentRoom,
                userName: currentUser
            }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error("Failed to parse WebSocket message:", error, event.data);
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            showStatus('Connection lost. Please refresh the page.', 'error');
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            showStatus('Connection error', 'error');
        };
    }

    // Handle WebSocket messages
    function handleWebSocketMessage(data) {
        console.log('[WS RECEIVE]', data);
        switch (data.type) {
            case 'room_joined':
                showStatus(`Joined room: ${data.room.name}`, 'success');
                // History is now loaded from Firestore, so we don't need to handle it here.
                break;
                
            case 'user_joined':
                showStatus(`${data.userName} joined the room`, 'info');
                updateParticipants(data.participants);
                break;
                
            case 'user_left':
                showStatus(`${data.userName} left the room`, 'info');
                updateParticipants(data.participants);
                break;

            case 'drawing_update':
                console.log('[WS RECEIVE] Drawing update received from another user.');
                // Received a new drawing from another user.
                // The onSnapshot listener is the source of truth, but we can draw this
                // immediately for lower latency, then the listener will sync the state.
                const newEvent = data.drawingData;
                // Avoid adding a duplicate if the event is already in our history
                if (!drawingHistory.some(e => e.id === newEvent.id)) {
                    drawingHistory.push(newEvent);
                    applyDrawingEvent(newEvent);
                    updateUndoRedoButtons();
                }
                break;
                
            case 'clear_canvas':
                // Received a command to clear the canvas from another user.
                drawingHistory = []; // Clear local history
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                console.log("Canvas cleared by remote command from user:", data.user);
                break;

            case 'user_list_update':
                updateUserList(data.users);
                break;
        }
    }

    // Show status message
    function showStatus(message, type = 'info') {
        const statusMessage = document.getElementById('statusMessage');
        if (!statusMessage) return; // Status message might not exist in standalone mode
        
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';
        statusMessage.classList.add('show');
        
        setTimeout(() => {
            statusMessage.classList.remove('show');
            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 300);
        }, 5000);
    }

    // Update participants display
    function updateParticipants(participants) {
        const participantsElement = document.getElementById('roomParticipants');
        if (participantsElement) {
            participantsElement.textContent = `Participants: ${participants.join(', ')}`;
        }
    }

    // --- Canvas and Context Setup ---
    const canvas = document.getElementById('whiteboardCanvas');
    console.log('Canvas element:', canvas);
    const ctx = canvas.getContext('2d');
    const clearButton = document.getElementById('clearButton');
    const undoButton = document.getElementById('undoButton');
    const redoButton = document.getElementById('redoButton');

    // Get references to controls
    const toolButtons = document.querySelectorAll('.tool-button');
    const shapeIcons = document.querySelectorAll('.shape-icon');
    const colorPicker = document.getElementById('colorPicker');
    const lineWidthSlider = document.getElementById('lineWidthSlider');
    const lineWidthValueSpan = document.getElementById('lineWidthValue');

    // Canvas setup
    canvas.width = 800;
    canvas.height = 600;

    // Drawing state variables
    let savedImageData;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentPathPoints = [];
    let startShapeX = 0;
    let startShapeY = 0;
    let textInput = null;
    let drawingHistory = []; // In-memory store of all drawing events.

    // Tool state variables
    let currentTool = 'pencil';
    let currentColor = '#000000';
    let currentLineWidth = 5;

    // Initialize canvas context
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentLineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';

    savedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.fillRect(0, 0, canvas.width, canvas.height); // Start with a white background

    function updateCanvasContext() {
            if (currentTool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = currentColor;
            ctx.fillStyle = currentColor;
        }
        
            ctx.lineWidth = currentLineWidth;

        if (['pencil', 'eraser', 'brush'].includes(currentTool)) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        } else if (['line', 'rect', 'circle', 'curvedLine', 'hexagon', 'pentagon', 'rhombus', 'star', 'arrow'].includes(currentTool)) {
            ctx.lineCap = 'butt';
            ctx.lineJoin = 'miter';
        }
    }

    function updateCursor() {
        if (currentTool === 'text') {
            canvas.style.cursor = 'text';
        } else if (currentTool === 'eraser') {
            const size = Math.max(2, currentLineWidth); // Ensure a minimum size for visibility
            const half = size / 2;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half - 1}" fill="none" stroke="black" stroke-width="1"/></svg>`;
            canvas.style.cursor = `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') ${half} ${half}, auto`;
        } else {
            canvas.style.cursor = 'default';
        }
    }

    // --- Control Event Listeners ---
    toolButtons.forEach(button => {
        button.addEventListener('click', () => {
            toolButtons.forEach(btn => btn.classList.remove('active'));
            shapeIcons.forEach(icon => icon.classList.remove('active'));
            button.classList.add('active');
            currentTool = button.dataset.tool;

                if (textInput) {
                    finalizeTextInput(textInput.x, textInput.y);
                    textInput.remove();
                    textInput = null;
            }

            updateCursor();
            updateCanvasContext();
        });
    });

    shapeIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            toolButtons.forEach(btn => btn.classList.remove('active'));
            shapeIcons.forEach(i => i.classList.remove('active'));
            icon.classList.add('active');
            currentTool = icon.dataset.shape;

            if (textInput) {
                finalizeTextInput(textInput.x, textInput.y);
                textInput.remove();
                textInput = null;
            }
            
            updateCursor();
            updateCanvasContext();
        });
    });

    colorPicker.addEventListener('input', (e) => {
        currentColor = e.target.value;
        updateCanvasContext();
        if (currentTool === 'text' && textInput) {
            textInput.style.color = currentColor;
        }
    });

    lineWidthSlider.addEventListener('input', (e) => {
        currentLineWidth = parseInt(e.target.value);
        updateCanvasContext();
        lineWidthValueSpan.textContent = `${currentLineWidth}px`;
        updateCursor(); // Update cursor in case the eraser is active
        if (currentTool === 'text' && textInput) {
            textInput.style.fontSize = `${currentLineWidth}px`;
        }
    });

    undoButton.addEventListener('click', async () => {
        await globalUndo();
    });

    redoButton.addEventListener('click', async () => {
        await globalRedo();
    });

    const saveButton = document.getElementById('saveButton');
    saveButton.addEventListener('click', () => {
        // Create a temporary canvas to superimpose the drawing on a white background.
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;

        // Fill the temporary canvas with a white background.
        tempCtx.fillStyle = '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Draw the current whiteboard content on top of the white background.
        tempCtx.drawImage(canvas, 0, 0);

        // Create a temporary link element to trigger the download.
        const link = document.createElement('a');
        link.download = `drawing-${currentRoom}-${Date.now()}.png`;
        
        // Get the data URL from the temporary canvas, which now includes the background.
        link.href = tempCanvas.toDataURL('image/png');
        
        // Programmatically click the link.
        link.click();
        showStatus('Drawing saved!', 'success');
    });

    clearButton.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear the canvas?')) {
            // 1. Clear the local canvas immediately.
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 2. Broadcast a 'clear_canvas' message to all other clients for an instant update.
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                    type: 'clear_canvas',
                    roomId: currentRoom,
                    user: currentUser
                }));
            }

            // 3. Delete all drawing documents from Firestore to clear the persistent history.
            if (userId) {
                try {
                    // Use room-specific collection if in room mode, otherwise use original path
                    const collectionPath = isRoomMode ? `rooms/${currentRoom}/drawings` : `artifacts/${appId}/public/data/drawings`;
                    const drawingsCollectionRef = db.collection(collectionPath);
                    const snapshot = await drawingsCollectionRef.get();

                    const deletePromises = [];
                    snapshot.docs.forEach(doc => {
                        deletePromises.push(doc.ref.delete());
                    });

                    await Promise.all(deletePromises);
                    console.log("Firestore drawing history cleared.");
                    
                    // Clear the deleted actions array since we've cleared everything
                    drawingHistory = [];
                    updateUndoRedoButtons();
                    showStatus('Canvas cleared', 'success');
                } catch (error) {
                    console.error("Error clearing Firestore drawing history:", error);
                }
            }
        }
    });

    // Room action buttons (only in room mode)
    const copyRoomIdBtn = document.getElementById('copyRoomId');
    const leaveRoomBtn = document.getElementById('leaveRoom');

    if (isRoomMode && copyRoomIdBtn && leaveRoomBtn) {
        copyRoomIdBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(currentRoom);
                showStatus('Room ID copied to clipboard!', 'success');
            } catch (error) {
                console.error('Failed to copy room ID:', error);
                showStatus('Failed to copy room ID', 'error');
            }
        });

        leaveRoomBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to leave this room?')) {
                if (ws) {
                    ws.close();
                }
                window.location.href = '/';
            }
        });
    }

    // --- Drawing Event Handlers ---
    canvas.addEventListener('mousedown', (e) => {
        if (textInput) {
            finalizeTextInput(textInput.x, textInput.y);
            textInput.remove();
            textInput = null;
        }

        isDrawing = true;
        [lastX, lastY] = [e.offsetX, e.offsetY];
        startShapeX = e.offsetX;
        startShapeY = e.offsetY;

        if (['pencil', 'eraser', 'brush'].includes(currentTool)) {
            currentPathPoints = [{ x: lastX, y: lastY }];
        }
        
        updateCanvasContext();
        savedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height); // Save state before drawing
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        
        const currentX = e.offsetX;
        const currentY = e.offsetY;

        if (['pencil', 'eraser', 'brush'].includes(currentTool)) {
            draw(currentX, currentY);
            currentPathPoints.push({ x: currentX, y: currentY });
        } else if (['line', 'rect', 'circle', 'curvedLine', 'hexagon', 'pentagon', 'rhombus', 'star', 'arrow'].includes(currentTool)) {
            ctx.putImageData(savedImageData, 0, 0); // Restore to previous state
            drawShape(currentTool, startShapeX, startShapeY, currentX, currentY);
        }
    });

    canvas.addEventListener('mouseup', async (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        
        // Generate a unique ID for this drawing event on the client side.
        const eventId = crypto.randomUUID();

        const drawingEvent = {
            id: eventId, // Use the client-generated ID
            tool: currentTool,
            color: currentColor,
            lineWidth: currentLineWidth,
            startX: startShapeX,
            startY: startShapeY,
            endX: e.offsetX,
            endY: e.offsetY,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            userId: userId,
            userName: currentUser,
            deleted: false
        };

        if (['pencil', 'eraser', 'brush'].includes(currentTool)) {
            drawingEvent.points = currentPathPoints;
        }

        if (currentTool === 'text') {
            createOrMoveTextInput(e.offsetX, e.offsetY);
        } else {
            // Add to our local history immediately for a responsive feel.
            drawingHistory.push(drawingEvent);

            // Send to Firestore using the generated ID.
            if (userId) {
                try {
                    const collectionPath = isRoomMode ? `rooms/${currentRoom}/drawings` : `artifacts/${appId}/public/data/drawings`;
                    // Use .doc(id).set() to enforce our client-generated ID.
                    await db.collection(collectionPath).doc(drawingEvent.id).set(drawingEvent);
                    updateUndoRedoButtons();
                } catch (error) {
                    console.error("Error saving drawing to Firestore: ", error);
                }
            }

            // Send via WebSocket for real-time collaboration.
            if (isRoomMode && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'drawing_data',
                    drawingData: drawingEvent
                }));
            }
        }
        currentPathPoints = []; // Reset path
    });

    canvas.addEventListener('mouseout', () => {
        if (isDrawing) {
            // isDrawing = false;
        }
    });

    function draw(x, y) {
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        [lastX, lastY] = [x, y];
    }
    
    function createOrMoveTextInput(x, y) {
        if (textInput) {
            finalizeTextInput(textInput.x, textInput.y);
            textInput.remove();
        }

        textInput = document.createElement('div');
        textInput.contentEditable = true;
        textInput.className = 'text-input';
        textInput.style.position = 'absolute';
        textInput.style.left = `${canvas.offsetLeft + x}px`;
        textInput.style.top = `${canvas.offsetTop + y}px`;
        textInput.style.color = currentColor;
        textInput.style.fontSize = `${currentLineWidth}px`;
        textInput.style.fontFamily = 'Arial, sans-serif'; 
        textInput.style.lineHeight = '1.2';
        textInput.style.outline = 'none';
        textInput.style.border = '1px dashed #ccc';
        textInput.style.padding = '2px';
        textInput.x = x;
        textInput.y = y;

        document.body.appendChild(textInput);
        textInput.focus();

        const finalize = () => {
            if (document.body.contains(textInput)) {
                finalizeTextInput(textInput.x, textInput.y);
                document.body.removeChild(textInput);
                textInput = null;
            }
        };

        textInput.addEventListener('blur', finalize);
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finalize();
            }
        });
    }

    function drawShape(shape, startX, startY, endX, endY) {
        ctx.beginPath();
        switch (shape) {
            case 'line':
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                break;
            case 'rect':
                ctx.rect(startX, startY, endX - startX, endY - startY);
                break;
            case 'circle':
                const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
                ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
                break;
            case 'curvedLine':
                ctx.moveTo(startX, startY);
                ctx.quadraticCurveTo(startX + (endX - startX) / 2, startY - (startY - endY), endX, endY);
                break;
            case 'hexagon':
                drawPolygon(startX, startY, endX, endY, 6);
                break;
            case 'pentagon':
                drawPolygon(startX, startY, endX, endY, 5);
                break;
            case 'rhombus':
                drawPolygon(startX, startY, endX, endY, 4);
                break;
            case 'star':
                drawStar(startX, startY, endX, endY, 5);
                break;
            case 'arrow':
                drawArrow(startX, startY, endX, endY);
                break;
        }
        ctx.stroke();
    }
    
    function drawPolygon(startX, startY, endX, endY, sides) {
        const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        const angle = (2 * Math.PI) / sides;
        ctx.moveTo(startX + radius * Math.cos(0), startY + radius * Math.sin(0));
        for (let i = 1; i <= sides; i++) {
            ctx.lineTo(startX + radius * Math.cos(i * angle), startY + radius * Math.sin(i * angle));
        }
    }
    
    function drawStar(startX, startY, endX, endY, points) {
        const outerRadius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        const innerRadius = outerRadius / 2;
        const angle = Math.PI / points;
        
        ctx.moveTo(startX, startY - outerRadius);
        for (let i = 0; i < 2 * points; i++) {
            const radius = (i % 2 === 0) ? outerRadius : innerRadius;
            const currentAngle = i * angle - Math.PI / 2;
            ctx.lineTo(startX + radius * Math.cos(currentAngle), startY + radius * Math.sin(currentAngle));
        }
        ctx.closePath();
    }
    
    function drawArrow(startX, startY, endX, endY) {
        const headlen = 10; 
        const dx = endX - startX;
        const dy = endY - startY;
        const angle = Math.atan2(dy, dx);
        
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
    }

    function finalizePath(path) {
        if (path.points.length < 2) return;
        const event = { type: 'path', ...path, id: crypto.randomUUID() };
        drawingHistory.push(event);
        if (isRoomMode && ws && ws.readyState === WebSocket.OPEN) {
            console.log('[WS SEND] Sending path data:', event);
            ws.send(JSON.stringify({ type: 'drawing_data', drawingData: event }));
        }
    }

    function finalizeShape(shape, startX, startY, endX, endY) {
        const event = { type: 'shape', shape, startX, startY, endX, endY, color: currentColor, lineWidth: currentLineWidth, id: crypto.randomUUID() };
        drawingHistory.push(event);
        if (isRoomMode && ws && ws.readyState === WebSocket.OPEN) {
            console.log('[WS SEND] Sending shape data:', event);
            ws.send(JSON.stringify({ type: 'drawing_data', drawingData: event }));
        }
    }

    async function finalizeTextInput(x, y) {
        if (!textInput) return;
        const text = textInput.value;
        if (text && text.trim() !== '') {
            const event = { type: 'text', text, x, y, color: currentColor, id: crypto.randomUUID() };
            drawingHistory.push(event);
            applyDrawingEvent(event); // Draw it immediately
            if (isRoomMode && ws && ws.readyState === WebSocket.OPEN) {
                console.log('[WS SEND] Sending text data:', event);
                ws.send(JSON.stringify({ type: 'drawing_data', drawingData: event }));
            }
        }
        document.body.removeChild(textInput);
        textInput = null;
    }

    // --- Firestore Interaction ---
    function setupFirestoreListener() {
        if (!userId) {
            console.warn("Cannot set up Firestore listener: userId is null.");
            return;
        }

        const collectionPath = isRoomMode ? `rooms/${currentRoom}/drawings` : `artifacts/${appId}/public/data/drawings`;
        
        db.collection(collectionPath)
            .orderBy('timestamp', 'asc')
            .onSnapshot(snapshot => {
                console.log(`Firestore snapshot received with ${snapshot.size} total documents.`);
                
                const remoteHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // More robustly merge remote history with local history.
                // This prevents flickering and handles missed WebSocket messages.
                drawingHistory = remoteHistory;
                redrawFromHistory();
                updateUndoRedoButtons();

            }, error => {
                console.error("Error with Firestore listener: ", error);
            });
    }

    function applyDrawingEvent(event) {
        ctx.strokeStyle = event.color;
        ctx.lineWidth = event.lineWidth;
        
        // Temporarily set globalCompositeOperation for eraser events
        const originalCompositeOp = ctx.globalCompositeOperation;
        if (event.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)'; // Eraser needs a "color" to erase with
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = event.color; // For text
        }
    
        if (event.tool === 'text') {
            ctx.font = `${event.lineWidth}px Arial`;
            ctx.fillText(event.text, event.x, event.y);
        } else if (event.points) { // For freehand drawing (pencil, brush, eraser)
            ctx.beginPath();
            ctx.moveTo(event.points[0].x, event.points[0].y);
            for (let i = 1; i < event.points.length; i++) {
                ctx.lineTo(event.points[i].x, event.points[i].y);
            }
            ctx.stroke();
        } else { // For shapes
            drawShape(event.tool, event.startX, event.startY, event.endX, event.endY);
        }

        // Restore the original composite operation
        ctx.globalCompositeOperation = originalCompositeOp;
    }

    // This function is now the single source of truth for drawing on the canvas.
    function redrawFromHistory() {
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        drawingHistory.forEach(event => {
            if (!event.deleted) {
                applyDrawingEvent(event);
            }
        });
    }

    async function updateUndoRedoButtons() {
        if (!userId) return;

        // Base the button state on the in-memory history.
        const canUndo = drawingHistory.some(e => !e.deleted);
        const canRedo = drawingHistory.some(e => e.deleted);
        
        undoButton.disabled = !canUndo;
        redoButton.disabled = !canRedo;
    }

    async function globalUndo() {
        if (!userId) return;
        
        // Find the last action in our local history that isn't deleted.
        const lastAction = drawingHistory.slice().reverse().find(e => !e.deleted);
        
        if (lastAction) {
            console.log(`Locally undoing action ${lastAction.id}`);
            // Mark as deleted locally for immediate UI feedback.
            lastAction.deleted = true; 
            redrawFromHistory();
            updateUndoRedoButtons();

            // Persist the change to Firestore. The onSnapshot listener will handle syncing all clients.
            const collectionPath = isRoomMode ? `rooms/${currentRoom}/drawings` : `artifacts/${appId}/public/data/drawings`;
            try {
                await db.collection(collectionPath).doc(lastAction.id).update({ deleted: true });
            } catch (error) {
                console.error("Error during undo persistence:", error);
                // Revert if the DB operation fails
                lastAction.deleted = false;
                redrawFromHistory();
                updateUndoRedoButtons();
            }
        }
    }

    async function globalRedo() {
        if (!userId) return;

        // Find the most recently deleted action in our local history.
        const actionToRedo = drawingHistory.slice().reverse().find(e => e.deleted);

        if (actionToRedo) {
            console.log(`Locally redoing action ${actionToRedo.id}`);
            // Mark as not deleted locally for immediate UI feedback.
            actionToRedo.deleted = false;
            redrawFromHistory();
            updateUndoRedoButtons();

            // Persist the change to Firestore.
            const collectionPath = isRoomMode ? `rooms/${currentRoom}/drawings` : `artifacts/${appId}/public/data/drawings`;
            try {
                await db.collection(collectionPath).doc(actionToRedo.id).update({ deleted: false });
            } catch (error) {
                console.error("Error during redo persistence:", error);
                // Revert if the DB operation fails
                actionToRedo.deleted = true;
                redrawFromHistory();
                updateUndoRedoButtons();
            }
        }
    }

    // --- Initial Load ---
    if (isRoomMode) {
        initializeRoomDisplay();
    }
    authenticateAndLoad();

    // Resize canvas based on container
    function resizeCanvas() {
        const canvasContainer = document.querySelector('.canvas-container');
        if (!canvasContainer) {
            console.error("Canvas container not found!");
            return;
        }

        const controlsHeight = document.querySelector('.controls').offsetHeight;
        const headerHeight = document.querySelector('header').offsetHeight;
        const roomHeader = document.querySelector('.room-header');
        const roomHeaderHeight = isRoomMode && roomHeader ? roomHeader.offsetHeight : 0;
        const availableHeight = window.innerHeight - headerHeight - controlsHeight - roomHeaderHeight - 60; // 60px for padding/margins
        const availableWidth = canvasContainer.offsetWidth;

        const scale = window.devicePixelRatio || 1;
        
        // Save current drawing, resize, then redraw
        const currentDrawing = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        canvas.width = availableWidth * scale;
        canvas.height = availableHeight * scale;
        canvas.style.width = `${availableWidth}px`;
        canvas.style.height = `${availableHeight}px`;
        ctx.scale(scale, scale);

        redrawFromHistory(); // Always redraw from the source of truth
    }
    
    // Initial and resize listener
    window.addEventListener('resize', resizeCanvas);

    // Handle page unload
    window.addEventListener('beforeunload', () => {
        if (ws) {
            ws.close();
        }
    });
});
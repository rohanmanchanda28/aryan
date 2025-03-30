// require('dotenv').config(); // No longer needed
const express = require('express');
// const axios = require('axios'); // No longer needed
const cors = require('cors');
const path = require('path'); // Needed for serving static files correctly

const app = express();
const port = process.env.PORT || 5001; 

app.use(cors()); 
// app.use(express.json()); // No longer needed as we don't process JSON bodies

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // No longer needed
// const OPENAI_API_URL = 'https://api.openai.com/v1'; // No longer needed

// No longer need to check for API key on server startup
// if (!OPENAI_API_KEY) { ... }

// --- Serve Static Files --- 
// Serve JS and CSS from the 'static' directory
app.use(express.static(path.join(__dirname, 'static')));

// Serve index.html from the root or 'templates' directory
// Adjust if your index.html is elsewhere
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// --- Remove unused /get-session-token endpoint --- 
/*
app.post('/get-session-token', async (req, res) => {
    // ... (entire endpoint logic removed) ...
});
*/

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    console.log(`Serving static files from ${path.join(__dirname, 'static')}`);
    console.log(`Serving index.html from ${path.join(__dirname, 'templates', 'index.html')}`);
    // No longer need the API key warning here
}); 
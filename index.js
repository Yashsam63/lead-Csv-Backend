require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csvtojson');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Models (Ensure folder name is 'models' in lowercase)
const User = require('./models/User');
const userLog = require('./models/UserLog');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ✅ Vercel Fix: Use Memory Storage instead of Disk Storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const JWT_SECRET = process.env.JWT_SECRET;

// ✅ MongoDB Connection with Error Handling
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("🚀 Connected to MongoDB"))
    .catch(err => console.error("❌ Connection error:", err));

// --- ROUTES ---

app.get('/', (req, res) => {
    res.send('Welcome to the backend server! Backend is Live.');
});

// ✅ Date Parsing Function
const formatToDate = (dateStr) => {
    if (!dateStr || dateStr.trim() === "" || dateStr === "null") return null;
    try {
        let cleanDate = dateStr.trim();
        if (cleanDate.includes('/')) {
            const [day, month, year] = cleanDate.split('/');
            return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
        }
        const parsed = new Date(cleanDate);
        if (!isNaN(parsed.getTime())) return parsed;
        return null;
    } catch (e) {
        return null;
    }
};

// ✅ Vercel Fix: CSV Upload using Buffer
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // Convert buffer to string for csvtojson
        const csvData = req.file.buffer.toString('utf8');
        const jsonArray = await csv().fromString(csvData);

        const cleanedData = jsonArray
            .filter(row => row.Email && row.Email.trim() !== "")
            .map(row => ({
                name: row.Name || `${row["First Name"] || ""} ${row["Last Name"] || ""}`.trim(),
                email: row.Email.trim(),
                companyName: row['Company Name'],
                website: row.Website,
                phoneNumber: row['Phone Number'],
                response: row['Response to Email'],
                leadGeneratorName: row['Lead Generator Name'],
                leadResponseDate: formatToDate(row['Lead Response Date']),
                leadSentDate: formatToDate(row['Sent to you date'])
            }));

        if (cleanedData.length === 0) {
            return res.status(400).json({ error: "No valid data found in CSV" });
        }

        await User.insertMany(cleanedData, { ordered: false });
        res.status(200).json({ message: "Upload Success", count: cleanedData.length });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(200).json({ message: "Partial Success (Duplicates skipped)" });
        }
        console.error("Server Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Fetch Leads with Sort
app.get('/all-leads', async (req, res) => {
    try {
        const leads = await User.find().sort({ createdAt: -1 }).limit(100);
        res.json(leads);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ✅ Admin Auth Middleware
const verifyAdmin = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ message: "No token, authorization denied" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: "Token is not valid" });
    }
};

// ✅ Auth Routes
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await userLog.findOne({ username });
        if (!user) return res.status(400).json({ message: "Username not found!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token, username: user.username });
        } else {
            res.status(401).json({ message: "Wrong password!" });
        }
    } catch (err) {
        res.status(500).json({ message: "Login error" });
    }
});

// ✅ Delete Route
app.delete('/leads/:id', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Lead deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ Vercel Fix: Export the app
module.exports = app;

// Local Development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
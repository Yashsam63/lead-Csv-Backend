require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csvtojson');
const User = require('./models/User');
const fs = require('fs');
const cors = require('cors');
const Lead = require('./models/User');
const auth = require('./middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userLog = require('./models/UserLog');
const uploadRoute = require('./routes/uploadRoute');
const leadRoute = require('./routes/allLeadsRoute');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("🚀 Connected to MongoDB"))
    .catch(err => console.error("❌ Connection error:", err));

app.get('/', (req, res) => {
    res.send('Welcome to the backend server!');
});

app.use('/', uploadRoute);
app.use('/', leadRoute);


app.get('/leads/recent', async (req, res) => {
    try {
        const recentLeads = await User.find().sort({ createdAt: -1 }).limit(8);
        res.json(recentLeads);
    } catch (error) {
        res.status(500).json({ message: "Error fetching recent leads" });
    }
});

// GET /export
app.get('/export', async (req, res) => {
    try {
        const { start, end, generator } = req.query;
        let query = {};

        // 1. Generator Filter
        if (generator && generator.trim() !== "") {
            query["metadata.generated_by"] = { $regex: generator.trim(), $options: 'i' };
        }

        // Saara data fetch karo
        let data = await Lead.find(query).lean();

        // 2. Date Filter Logic (In-Memory)
        if (start || end) {
            const startDate = start ? new Date(start) : null;
            const endDate = end ? new Date(end) : null;
            if (endDate) endDate.setHours(23, 59, 59, 999);

            data = data.filter(item => {
                const dateStr = item.metadata?.sent_date; 
                if (!dateStr) return false;

                const [day, month, year] = dateStr.split('-');
                const itemDate = new Date(`${year}-${month}-${day}`);

                if (startDate && itemDate < startDate) return false;
                if (endDate && itemDate > endDate) return false;
                return true;
            });
        }

        // 3. Poora data bhej do bina mapping ke
        // Taaki frontend ko saari nested fields (metadata.template_used etc.) mil sakein
        res.json(data);

    } catch (error) {
        console.error("Export Error:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

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

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await userLog.findOne({ username });
        if (existingUser) return res.status(400).json({ message: "Username already taken!" });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = new userLog({ username, password: hashedPassword });
        await newUser.save();
        res.json({ message: "Admin User Created Successfully!" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await userLog.findOne({ username });
    if (!user) return res.status(400).json({ message: "Username not found!" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, username: user.username });
    } else {
        res.status(401).json({ message: "Wrong password!" });
    }
});

app.get('/api/users', verifyAdmin, async (req, res) => {
    try {
        const users = await userLog.find({});
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: "Error" });
    }
});

app.delete('/api/users/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.id === id) return res.status(400).json({ message: "Cannot delete yourself" });
        await userLog.findByIdAndDelete(id);
        res.json({ message: "User deleted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error deleting user" });
    }
});

app.delete('/leads/:id', async (req, res) => {
    try {
        await Lead.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Lead successfully deleted" });
    } catch (err) {
        res.status(500).json({ message: "Error deleting lead", error: err.message });
    }
});

app.post('/leads/delete-multiple', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || ids.length === 0) return res.status(400).json({ message: "Select at least one lead to delete" });
        await Lead.deleteMany({ _id: { $in: ids } });
        res.status(200).json({ message: "Selected leads deleted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error in bulk delete", error: err.message });
    }
});

// --- VERCEL EXPORT (Zaroori) ---
module.exports = app;

// Local development ke liye ye chalta rahega
if (process.env.NODE_ENV !== 'production') {
    app.listen(5000, () => console.log("Server on 5000"));
}
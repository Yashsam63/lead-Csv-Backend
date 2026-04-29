require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csvtojson');
const User = require('./models/User');
const fs = require('fs');
const cors = require('cors');
const Lead = require('./models/User');


const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("🚀 Connected to MongoDB"))
    .catch(err => console.error("❌ Connection error:", err));

app.get('/', (req, res) => {
    res.send('Welcome to the backend server!');
});

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userLog = require('./models/UserLog'); // Path check kar lena bhai

const JWT_SECRET = process.env.JWT_SECRET; // Isse secure rakhna


// ✅ Improved Date Parsing Function
const formatToDate = (dateStr) => {
    if (!dateStr || dateStr.trim() === "" || dateStr === "null") return null;

    try {
        let cleanDate = dateStr.trim();

        // Agar "15/04/2026" format hai
        if (cleanDate.includes('/')) {
            const [day, month, year] = cleanDate.split('/');
            // JavaScript needs YYYY-MM-DD
            return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
        }

        // Agar "14-Apr-26" format hai (JS usually understands this)
        const parsed = new Date(cleanDate);
        if (!isNaN(parsed.getTime())) return parsed;

        return null;
    } catch (e) {
        return null;
    }
};

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const jsonArray = await csv().fromFile(req.file.path);

        const cleanedData = jsonArray
            .filter(row => row.Email && row.Email.trim() !== "") // Email must exist
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

        // ✅ ordered: false handles duplicate emails without crashing the whole upload
        await User.insertMany(cleanedData, { ordered: false });

        fs.unlinkSync(req.file.path);
        res.status(200).json({ message: "Upload Success", count: cleanedData.length });
    } catch (error) {
        // 11000 is for duplicate email skip
        if (error.code === 11000) {
            return res.status(200).json({ message: "Partial Success (Duplicates skipped)" });
        }
        console.error("Server Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/all-leads', async (req, res) => {
    try {
        const { sortBy } = req.query;
        // Default to 'leadSentDate' if nothing is passed
        const sortField = sortBy || 'leadSentDate';
        // Backend Controller
        const leads = await Lead.find().sort({ createdAt: -1 }).limit(10);
        // Ya agar upload date se karna hai:
        // const leads = await Lead.find().sort({ leadSentDate: -1 });
        res.json(leads);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/search', async (req, res) => {
    try {
        const searchTerm = req.query.query;

        if (!searchTerm || searchTerm.trim() === "") {
            return res.json([]);
        }

        // Term ko clean karo
        const term = searchTerm.trim();

        const results = await User.find({
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { email: { $regex: term, $options: 'i' } },
                { companyName: { $regex: term, $options: 'i' } },
                { website: { $regex: term, $options: 'i' } },
                { leadGeneratorName: { $regex: term, $options: 'i' } },
                { phoneNumber: { $regex: term, $options: 'i' } },

                // --- DATE SEARCH LOGIC ---
                // $expr allows us to use aggregation operators inside find()

                {
                    $expr: {
                        $regexMatch: {
                            input: { $dateToString: { format: "%d/%m/%Y", date: "$leadResponseDate" } },
                            regex: term,
                            options: "i"
                        }
                    }
                }
            ]
        }).limit(50);

        res.status(200).json(results);
    } catch (error) {
        console.error("Search Error:", error);
        res.status(500).json({ message: "Server error during search" });
    }
});

app.get('/leads/recent', async (req, res) => {
    try {
        // -1 ka matlab hai Latest First (Descending)
        const recentLeads = await User.find().sort({ createdAt: -1 }).limit(8);
        res.json(recentLeads);
    } catch (error) {
        res.status(500).json({ message: "Error fetching recent leads" });
    }
});
// Example Node/Express route
app.get('/export', async (req, res) => {
    try {
        const { start, end, generator } = req.query;
        let query = {};

        if (start && end) {
            query.leadSentDate = { $gte: new Date(start), $lte: new Date(end) };
        }
        if (generator) {
            query.leadGeneratorName = { $regex: generator, $options: 'i' };
        }

        // 1. .select("-__v -_id") se ye dono columns query se hi hat jayenge
        // 2. .lean() se humein plain JavaScript object milega jise hum edit kar sakte hain
        const data = await Lead.find(query).select("-__v -_id").lean();

        // 3. Date format ko clean karne ke liye loop chalao
        const cleanData = data.map(item => ({
            ...item,
            // Dono dates ko clean karke YYYY-MM-DD banaya
            leadSentDate: item.leadSentDate ? new Date(item.leadSentDate).toISOString().split('T')[0] : '',
            leadResponseDate: item.leadResponseDate ? new Date(item.leadResponseDate).toISOString().split('T')[0] : ''
        }));

        res.json(cleanData);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});




// Middleware to verify JWT and Admin access
const verifyAdmin = (req, res, next) => {
    // Frontend se token 'x-auth-token' header mein aayega
    const token = req.header('x-auth-token');

    // Check agar token hai hi nahi
    if (!token) {
        return res.status(401).json({ message: "No token, authorization denied" });
    }

    try {
        // Token ko verify karo
        const decoded = jwt.verify(token, JWT_SECRET);

        // User data ko request object mein daal do taaki aage use ho sake
        req.user = decoded;

        // Agle function (yaani aapka async route) par bhejo
        next();
    } catch (err) {
        res.status(401).json({ message: "Token is not valid" });
    }
};

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 1. Check karo user pehle se toh nahi hai
        const existingUser = await userLog.findOne({ username });
        if (existingUser) return res.status(400).json({ message: "Username already taken!" });

        // 2. Password ko encrypt (hash) karo
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Naya user save karo
        const newUser = new userLog({
            username,
            password: hashedPassword
        });

        await newUser.save();
        res.json({ message: "Admin User Created Successfully!" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
});

// --- LOGIN ROUTE ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await userLog.findOne({ username });

    if (!user) {
        return res.status(400).json({ message: "Username not found!" });
    }

    // ZAROORI: compare function use karo
    const isMatch = await bcrypt.compare(password, user.password);

    if (isMatch) {
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET , { expiresIn: '24h' });
        res.json({ token, username: user.username });
    } else {
        res.status(401).json({ message: "Wrong password!" });
    }
});

// --- Saare Users Fetch Karne ke liye ---
app.get('/api/users', verifyAdmin, async (req, res) => {
    try {
        const users = await userLog.find({}); // Check karne ke liye sab kuch find karo
        res.json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error" });
    }
});

// --- User Delete Karne ke liye ---
app.delete('/api/users/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        // Khud ko delete karne se bachne ke liye logic (optional)
        if (req.user.id === id) return res.status(400).json({ message: "Cannot delete yourself" });

        await userLog.findByIdAndDelete(id);
        res.json({ message: "User deleted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error deleting user" });
    }
});

// 1. Single Delete
// 1. Single Delete Route
app.delete('/leads/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Yahan 'Lead' wahi hona chahiye jo aapne upar define kiya hai
        await Lead.findByIdAndDelete(id);
        res.status(200).json({ message: "Lead successfully deleted" });
    } catch (err) {
        res.status(500).json({ message: "Error deleting lead", error: err.message });
    }
});

// 2. Bulk Delete Route
app.post('/leads/delete-multiple', async (req, res) => {
    try {
        const { ids } = req.body; // Frontend se [id1, id2, ...] aayega

        if (!ids || ids.length === 0) {
            return res.status(400).json({ message: "Select at least one lead to delete" });
        }

        // $in operator saari selected IDs ko ek saath delete kar dega
        await Lead.deleteMany({ _id: { $in: ids } });

        res.status(200).json({ message: "Selected leads deleted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error in bulk delete", error: err.message });
    }
});

app.listen(5000, () => console.log("Server on 5000")); 

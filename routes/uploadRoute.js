const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const User = require('../models/User');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helpers
const cleanString = (str) => str?.toString().toLowerCase().replace(/[^a-z0-9]/g, '') || "";
const smartFormatDate = (val) => {
    if (!val) return "";
    if (val instanceof Date) {
        const d = new Date(val.getTime() + Math.abs(val.getTimezoneOffset() * 60000));
        return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    }
    return val.toString();
};

router.post('/upload', upload.array('files'), async (req, res) => {
    try {
        // 1. Initial Check
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "Bhai, koi file receive nahi hui!" });
        }

        let allCleanedData = [];

        // Helper: Symbols aur spaces saaf karne ke liye
        const cleanString = (str) => str?.toString().toLowerCase().replace(/[^a-z0-9]/g, '') || "";

        // Helper: Date format karne ke liye
        const smartFormatDate = (val) => {
            if (!val) return "";
            if (val instanceof Date) {
                const d = new Date(val.getTime() + Math.abs(val.getTimezoneOffset() * 60000));
                return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
            }
            return val.toString();
        };

        // 2. Loop through every file
        for (const file of req.files) {
            const fileName = file.originalname;
            const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true });
            let rows = [];

            for (let sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const currentRows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
                if (currentRows.length > 0) { rows = currentRows; break; }
            }

            if (rows.length === 0) continue;

            // 3. Header Normalization
            let headerRowIndex = rows.findIndex(row =>
                row.some(cell => cleanString(cell) === 'email')
            );
            if (headerRowIndex === -1) headerRowIndex = 0;

            const headers = Array.from(rows[headerRowIndex] || []).map(h => cleanString(h));
            const dataRows = rows.slice(headerRowIndex + 1);

            // 4. Data Mapping
            const fileData = dataRows.map((row) => {
                const getVal = (targetName) => {
                    const idx = headers.indexOf(cleanString(targetName));
                    return (idx !== -1 && row[idx] !== undefined) ? row[idx] : "";
                };

                const findByAliases = (aliases) => {
                    for (let alias of aliases) {
                        const val = getVal(alias);
                        if (val !== undefined && val !== "" && val !== null) return val;
                    }
                    return "";
                };

                const email = getVal('email')?.toString().trim().toLowerCase();
                if (!email || email === 'email') return null;

                // --- ALIAS MAPPING ---

                // Names
                const fName = findByAliases(['firstname', 'fname', 'first', 'givenname', 'fstname']);
                const lName = findByAliases(['lastname', 'lname', 'last', 'surname', 'familyname', 'lstname']);
                const fullName = fName ? `${fName} ${lName}`.trim() : findByAliases(['name', 'names', 'nme', 'nmaes', 'fullname', 'clientname', 'leadname', 'customername', 'contactname', 'personname']);

                // Company & Industry
                const company = findByAliases(['company', 'businessname', 'companyname', 'organization', 'agency', 'corp', 'firm', 'bname', 'cname', 'workplace']);
                const industry = findByAliases(['industry', 'niche', 'sector', 'businessfield', 'category', 'vertical', 'market', 'biztype', 'indus']);

                // Contact & Location
                const phone = findByAliases(['phone', 'phonenumber', 'contact', 'mobile', 'cell', 'phne', 'phno', 'tel', 'cellnumber']);
                const website = findByAliases(['website', 'site', 'url', 'web', 'link', 'webaddress', 'domain', 'websiteurl']);
                const location = findByAliases(['location', 'address', 'city', 'state', 'country', 'loc', 'addr', 'region', 'zip', 'stateoriginal']);

                // Lead Info
                const leadType = findByAliases(['leadtype', 'type', 'status', 'category', 'leadstatus', 'stage', 'priority', 'tag']);
                const sno = findByAliases(['sno', 'id', 'srno', 'index', 'number', 'slno', 'ref']);

                // Response Text
                const responseText = findByAliases(['responsetoemail', 'response', 'responses', 'comment', 'comments', 'feedback', 'reply', 'replies', 'remarks', 'note', 'msg', 'message', 'conversation', 'responsesreceived', 'responsecomments', 'responsefromlead']);

                // --- SMART DATE FALLBACK LOGIC ---
                const genericDate = findByAliases(['date', 'dated', 'entrydate', 'timestamp', 'day']);
                const specificSentDate = findByAliases(['senttoyoudate', 'sentdate', 'datesent', 'timesent', 'outreachdate', 'maildate', 'dispatchdate']);
                const specificResponseDate = findByAliases(['leadresponsedate', 'responsedate', 'dateofresponse', 'replydate', 'responsetime', 'lastcontact']);

                const finalSentDate = specificSentDate || genericDate;
                const finalResponseDate = specificResponseDate || genericDate;

                // Other Details
                const reason = findByAliases(['reasonforreturn', 'returnreason', 'rejectedreason', 'reason', 'rejectreason', 'disqualifyreason', 'remark']);
                const agency = findByAliases(['agencydetails', 'agencyinfo', 'sourcedetails', 'provider', 'vendor', 'supplier', 'agencyname']);
                const generatedBy = findByAliases(['leadgenerator', 'generated', 'source', 'agent', 'leadgeneratedby', 'finder', 'scrapedby', 'origin', 'leadsgeneratedby', 'leadgeneratorname']);
                const template = findByAliases(['template', 'templateused', 'emailtemplate', 'outreachtemplate', 'script', 'messagetemplate']);

                return {
                    original_sno: sno?.toString() || "",
                    client_name: fullName || "Unknown",
                    email: email,
                    phone: phone?.toString() || "",
                    website: website || "",
                    lead_type: leadType || "",
                    industry: industry || "",
                    company_name: company || "",
                    location: location || "",
                    response_text: (responseText instanceof Date) ? "Yes" : (responseText || ""),
                    response_date: smartFormatDate(finalResponseDate),
                    reason_for_return: reason || "",
                    agency_details: agency || "",
                    metadata: {
                        generated_by: generatedBy || "",
                        template_used: template || "",
                        sent_date: smartFormatDate(finalSentDate),
                       raw_format: fileName 
                    }
                };
            }).filter(item => item !== null);

            allCleanedData = [...allCleanedData, ...fileData];
        }

        // 5. Database Bulk Operations
        if (allCleanedData.length === 0) {
            return res.status(400).json({ error: "Koi valid data process nahi hua!" });
        }

        const ops = allCleanedData.map(data => ({
            updateOne: {
                filter: { email: data.email },
                update: { $set: data },
                upsert: true
            }
        }));

        await User.bulkWrite(ops);

        res.status(200).json({
            message: `Ingestion Successful! 🚀`,
            totalRecords: allCleanedData.length,
            filesProcessed: req.files.length
        });

    } catch (error) {
        console.error("Critical Route Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
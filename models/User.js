const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  companyName: String,
  website: String,
  phoneNumber: String,
  response: String,
  leadGeneratorName: String,
  leadResponseDate: Date, // Date type for sorting
  leadSentDate: Date,     // Date type for sorting
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
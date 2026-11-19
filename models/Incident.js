const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({
  reporterName: { type: String, required: true, trim: true, maxlength: 80 },
  contact: { type: String, trim: true, maxlength: 40, default: "" },
  category: {
    type: String,
    required: true,
    enum: ["Flood", "Fire", "Earthquake", "Landslide", "Storm", "Other"]
  },
  location: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, required: true, trim: true, maxlength: 1500 },
  incidentDate: { type: Date, required: true, default: Date.now },
  photoUrl: { type: String, trim: true, default: "" },
  status: {
    type: String,
    enum: ["Pending", "Verified", "Resolved"],
    default: "Pending"
  },
  adminNotes: { type: String, trim: true, maxlength: 1000, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("Incident", incidentSchema);

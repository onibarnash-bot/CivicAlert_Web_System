require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const helmet = require("helmet");
const path = require("path");
const Incident = require("./models/Incident");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!process.env.MONGODB_URI) {
  console.error("Missing MONGODB_URI. Create a .env file using .env.example.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.error("Missing SESSION_SECRET or ADMIN_PASSWORD in environment variables.");
  process.exit(1);
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use((req, res, next) => {
  res.locals.isAdmin = Boolean(req.session.isAdmin);
  res.locals.message = req.session.message || null;
  delete req.session.message;
  next();
});

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    req.session.message = "Please sign in as an administrator first.";
    return res.redirect("/admin/login");
  }
  next();
}

function setMessage(req, message) {
  req.session.message = message;
}

function cleanIncident(body) {
  return {
    reporterName: String(body.reporterName || "").trim(),
    contact: String(body.contact || "").trim(),
    category: String(body.category || "").trim(),
    location: String(body.location || "").trim(),
    description: String(body.description || "").trim(),
    incidentDate: body.incidentDate ? new Date(body.incidentDate) : new Date(),
    photoUrl: String(body.photoUrl || "").trim()
  };
}

const validCategories = ["Flood", "Fire", "Earthquake", "Landslide", "Storm", "Other"];
const validStatuses = ["Pending", "Verified", "Resolved"];

// Public pages
app.get("/", async (req, res, next) => {
  try {
    const [recent, total, pending, verified, resolved] = await Promise.all([
      Incident.find({ status: { $in: validStatuses } }).sort({ createdAt: -1 }).limit(6).lean(),
      Incident.countDocuments(),
      Incident.countDocuments({ status: "Pending" }),
      Incident.countDocuments({ status: "Verified" }),
      Incident.countDocuments({ status: "Resolved" })
    ]);
    res.render("index", { recent, stats: { total, pending, verified, resolved } });
  } catch (err) { next(err); }
});

app.get("/report", (req, res) => res.render("report", { categories: validCategories }));

app.post("/report", async (req, res, next) => {
  try {
    const data = cleanIncident(req.body);
    if (!data.reporterName || !data.category || !data.location || !data.description) {
      setMessage(req, "Please complete all required fields.");
      return res.redirect("/report");
    }
    if (!validCategories.includes(data.category)) {
      setMessage(req, "Please select a valid incident category.");
      return res.redirect("/report");
    }
    if (data.photoUrl && !/^https?:\/\/.+/i.test(data.photoUrl)) {
      setMessage(req, "Photo link must start with http:// or https://.");
      return res.redirect("/report");
    }
    await Incident.create(data);
    setMessage(req, "Your incident report was submitted successfully.");
    res.redirect("/reports");
  } catch (err) { next(err); }
});

app.get("/reports", async (req, res, next) => {
  try {
    const filter = {};
    if (validCategories.includes(req.query.category)) filter.category = req.query.category;
    if (validStatuses.includes(req.query.status)) filter.status = req.query.status;
    const reports = await Incident.find(filter).sort({ createdAt: -1 }).lean();
    res.render("reports", { reports, categories: validCategories, statuses: validStatuses, selected: req.query });
  } catch (err) { next(err); }
});

// Administrator authentication
app.get("/admin/login", (req, res) => res.render("login"));
app.post("/admin/login", (req, res) => {
  if (req.body.password && req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.regenerate((err) => {
      if (err) return res.status(500).send("Could not start administrator session.");
      req.session.isAdmin = true;
      req.session.message = "Administrator sign-in successful.";
      res.redirect("/admin");
    });
  } else {
    setMessage(req, "Incorrect administrator password.");
    res.redirect("/admin/login");
  }
});
app.post("/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const reports = await Incident.find().sort({ createdAt: -1 }).lean();
    const stats = {
      total: reports.length,
      pending: reports.filter(x => x.status === "Pending").length,
      verified: reports.filter(x => x.status === "Verified").length,
      resolved: reports.filter(x => x.status === "Resolved").length
    };
    res.render("admin", { reports, stats, statuses: validStatuses });
  } catch (err) { next(err); }
});

// Update status and administrator notes
app.post("/admin/incidents/:id/update", requireAdmin, async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!validStatuses.includes(status)) {
      setMessage(req, "Invalid incident status.");
      return res.redirect("/admin");
    }
    await Incident.findByIdAndUpdate(req.params.id, {
      status,
      adminNotes: String(req.body.adminNotes || "").trim()
    }, { runValidators: true });
    setMessage(req, "Incident record updated.");
    res.redirect("/admin");
  } catch (err) { next(err); }
});

// Delete an incident record
app.post("/admin/incidents/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await Incident.findByIdAndDelete(req.params.id);
    setMessage(req, "Incident record deleted.");
    res.redirect("/admin");
  } catch (err) { next(err); }
});

// Edit report details (administrator only)
app.get("/admin/incidents/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const incident = await Incident.findById(req.params.id).lean();
    if (!incident) return res.status(404).render("404");
    res.render("edit", { incident, categories: validCategories });
  } catch (err) { next(err); }
});

app.post("/admin/incidents/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const data = cleanIncident(req.body);
    if (!data.reporterName || !data.category || !data.location || !data.description ||
        !validCategories.includes(data.category)) {
      setMessage(req, "Please provide valid values for all required fields.");
      return res.redirect(`/admin/incidents/${req.params.id}/edit`);
    }
    await Incident.findByIdAndUpdate(req.params.id, data, { runValidators: true });
    setMessage(req, "Incident details saved.");
    res.redirect("/admin");
  } catch (err) { next(err); }
});

// Simple JSON API for demonstration/integration
app.get("/api/incidents", async (req, res, next) => {
  try {
    const incidents = await Incident.find().sort({ createdAt: -1 }).lean();
    res.json(incidents);
  } catch (err) { next(err); }
});

app.get("/health", (req, res) => res.json({ status: "ok", service: "CivicAlert" }));

app.use((req, res) => res.status(404).render("404"));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render("error", {
    message: process.env.NODE_ENV === "production"
      ? "Something went wrong. Please try again later."
      : err.message
  });
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, () => console.log(`CivicAlert running on port ${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });

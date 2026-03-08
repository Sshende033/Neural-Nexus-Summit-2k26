import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";
import multer from "multer";
import fs from "fs";
import * as XLSX from "xlsx";
import { GoogleGenAI } from "@google/genai";

const db = new Database("registrations.db");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competition TEXT,
    teammates_count INTEGER,
    team_name TEXT,
    lead_name TEXT,
    email TEXT,
    phone TEXT,
    teammates_names TEXT,
    institution TEXT,
    department TEXT,
    esports_type TEXT,
    payment_screenshot TEXT,
    transaction_id TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

try {
  db.exec("ALTER TABLE registrations ADD COLUMN department TEXT");
} catch (e) {
  // Ignore if column already exists
}

try {
  db.exec("ALTER TABLE registrations ADD COLUMN esports_type TEXT");
} catch (e) {
  // Ignore if column already exists
}

try {
  db.exec("ALTER TABLE registrations ADD COLUMN payment_status TEXT DEFAULT 'pending'");
} catch (e) {
  // Ignore if column already exists
}

try {
  db.exec("ALTER TABLE registrations ADD COLUMN poster_topic TEXT");
} catch (e) {
  // Ignore if column already exists
}

try {
  db.exec("ALTER TABLE registrations ADD COLUMN transaction_id TEXT UNIQUE");
} catch (e) {
  // Ignore if column already exists
}

// Dynamic content tables
db.exec(`
  CREATE TABLE IF NOT EXISTS team (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    competition_id TEXT,
    name TEXT,
    phone TEXT,
    info TEXT,
    photo_url TEXT
  );

  CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    logo_url TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    rating INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    label TEXT,
    value TEXT,
    type TEXT -- 'email', 'phone', 'address', 'social', etc.
  );

  CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    note TEXT,
    date TEXT,
    icon TEXT,
    fees_individual INTEGER,
    fees_team INTEGER,
    max_team INTEGER,
    color TEXT,
    rules TEXT, -- JSON array
    prizes TEXT, -- JSON array
    schedule TEXT
  );
`);

// Migration: Add new columns to contacts
try { db.prepare("ALTER TABLE contacts ADD COLUMN name TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE contacts ADD COLUMN role TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE contacts ADD COLUMN phone TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE contacts ADD COLUMN email TEXT").run(); } catch (e) {}

// Initialize default competitions if not exists
const checkCompetitions = db.prepare("SELECT COUNT(*) as count FROM competitions").get() as { count: number };
if (checkCompetitions.count === 0) {
  const initialCompetitions = [
    {
      id: 'prompt-nova',
      name: 'Prompt - Nova',
      description: 'Write a prompt to AI for an expected output image.',
      date: '24th March',
      icon: 'PenTool',
      fees_individual: 50,
      fees_team: 100,
      max_team: 2,
      color: 'from-purple-500 to-blue-500',
      rules: JSON.stringify([
        'Participants must use the provided AI tools.',
        'Prompts must be original and not copied.',
        'Images will be judged on creativity and accuracy to the prompt.'
      ]),
      prizes: JSON.stringify(['1st Prize: ₹2000', '2nd Prize: ₹1000', 'Certificate of Participation for all']),
      schedule: '10:00 AM - 12:00 PM'
    },
    {
      id: 'poster-panorama',
      name: 'Poster Panorama',
      description: 'Digital & Handmade Poster presentation.',
      note: 'Digital & Handmade Poster presentation. The poster should be made previously.',
      date: '23rd March',
      icon: 'Search',
      fees_individual: 50,
      fees_team: 100,
      max_team: 2,
      color: 'from-emerald-500 to-teal-500',
      rules: JSON.stringify([
        'Posters must be original work.',
        'Digital posters must be submitted in high resolution.',
        'Handmade posters must be brought to the venue.'
      ]),
      prizes: JSON.stringify(['1st Prize: ₹2000', '2nd Prize: ₹1000', 'Certificate of Participation for all']),
      schedule: '1:00 PM - 3:00 PM'
    },
    {
      id: 'e-sports',
      name: 'E-Sports',
      description: '"Survive To DOMINATE" - BGMI / FREEFIRE',
      date: '24 March 2026',
      icon: 'Gamepad2',
      fees_individual: null,
      fees_team: 200,
      max_team: 4,
      color: 'from-orange-500 to-red-500',
      rules: JSON.stringify([
        'Teams must consist of exactly 4 players.',
        'Use of hacks or emulators is strictly prohibited.',
        'Players must bring their own devices and internet connection.'
      ]),
      prizes: JSON.stringify(['1st Prize: ₹5000', '2nd Prize: ₹2500', 'Certificate of Participation for all']),
      schedule: '2:00 PM - 6:00 PM'
    },
    {
      id: 'treasure-hunt',
      name: 'Treasure Hunt',
      description: 'Find the hidden treasure with the given clues.',
      date: '23rd March',
      icon: 'Trophy',
      fees_individual: 50,
      fees_team: 250,
      max_team: 5,
      color: 'from-yellow-500 to-orange-500',
      rules: JSON.stringify([
        'Teams must stay together at all times.',
        'Do not damage college property while searching.',
        'The first team to find the final treasure wins.'
      ]),
      prizes: JSON.stringify(['Winning Team: ₹3000', 'Certificate of Participation for all']),
      schedule: '4:00 PM - 6:00 PM'
    }
  ];

  const insertComp = db.prepare(`
    INSERT INTO competitions (id, name, description, note, date, icon, fees_individual, fees_team, max_team, color, rules, prizes, schedule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const comp of initialCompetitions) {
    insertComp.run(
      comp.id, comp.name, comp.description, comp.note || null, comp.date, comp.icon, 
      comp.fees_individual, comp.fees_team, comp.max_team, comp.color, comp.rules, comp.prizes, comp.schedule
    );
  }
}

// Initialize default venue if not exists
const checkVenue = db.prepare("SELECT * FROM settings WHERE key = 'venue_name'").get();
if (!checkVenue) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('venue_name', 'TGPCET Campus, 3rd Building, 4th Floor');
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('venue_address', 'AI & ML Department, Mohgao, NH44 Wardha Road');
}

// Initialize default contacts if not exists
const checkContacts = db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number };
if (checkContacts.count === 0) {
  db.prepare("INSERT INTO contacts (label, value, type) VALUES (?, ?, ?)").run('Email', 'neuralnexus@tgpcet.com', 'email');
  db.prepare("INSERT INTO contacts (label, value, type) VALUES (?, ?, ?)").run('Phone', '+91 98765 43210', 'phone');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Request logging
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // Setup multer for file uploads
  const uploadDir = "uploads";
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    },
  });

  const upload = multer({ storage: storage });

  // API Routes
  app.post("/api/register", upload.single("paymentScreenshot"), async (req, res) => {
    try {
      const {
        competition,
        teammatesCount,
        teamName,
        leadName,
        email,
        phone,
        teammatesNames,
        institution,
        department,
        esportsType,
        posterTopic,
        transactionId,
        amount,
      } = req.body;

      const paymentScreenshot = req.file ? req.file.path : null;

      if (!paymentScreenshot) {
        return res.status(400).json({ success: false, error: "Payment screenshot is required." });
      }

      // Check if transaction ID already exists
      if (transactionId) {
        const existingTx = db.prepare("SELECT id FROM registrations WHERE transaction_id = ?").get(transactionId);
        if (existingTx) {
          return res.status(400).json({ success: false, error: "Transaction ID already exists. Please provide a unique transaction ID." });
        }
      }

      const stmt = db.prepare(`
        INSERT INTO registrations (
          competition, teammates_count, team_name, lead_name, email, phone, teammates_names, institution, department, esports_type, poster_topic, payment_screenshot, transaction_id, payment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `);

      const result = stmt.run(
        competition,
        parseInt(teammatesCount),
        teamName,
        leadName,
        email,
        phone,
        teammatesNames,
        institution,
        department,
        esportsType || null,
        posterTopic || null,
        paymentScreenshot,
        transactionId || null
      );

      const registrationId = result.lastInsertRowid as number;
      
      // Auto-approve payment using AI synchronously
      let finalStatus = 'pending';
      try {
        finalStatus = await autoApprovePayment(registrationId, paymentScreenshot, competition, parseInt(teammatesCount), transactionId || null, parseInt(amount));
      } catch (aiError) {
        console.error("AI Approval failed, leaving as pending:", aiError);
      }

      res.json({ success: true, id: registrationId, status: finalStatus });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ success: false, error: "Failed to register" });
    }
  });

  // Public Content Routes
  app.get("/api/content", (req, res) => {
    try {
      const team = db.prepare("SELECT * FROM team").all();
      const sponsors = db.prepare("SELECT * FROM sponsors").all();
      const contacts = db.prepare("SELECT * FROM contacts").all();
      const competitions = db.prepare("SELECT * FROM competitions").all().map((c: any) => ({
        ...c,
        fees: { individual: c.fees_individual, team: c.fees_team },
        rules: c.rules ? JSON.parse(c.rules) : [],
        prizes: c.prizes ? JSON.parse(c.prizes) : []
      }));
      const settingsRows = db.prepare("SELECT * FROM settings").all() as {key: string, value: string}[];
      
      const settings = settingsRows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {} as Record<string, string>);

      const feedback = db.prepare("SELECT * FROM feedback ORDER BY created_at DESC LIMIT 10").all();

      res.json({ team, sponsors, contacts, settings, feedback, competitions });
    } catch (error) {
      console.error("Error fetching content:", error);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  // Admin Routes
  app.get("/api/admin/registrations", (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM registrations ORDER BY created_at DESC").all();
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch registrations" });
    }
  });

  app.patch("/api/admin/registrations/:id/status", (req, res) => {
    try {
      const { status } = req.body;
      db.prepare("UPDATE registrations SET payment_status = ? WHERE id = ?").run(status, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  app.delete("/api/admin/registrations/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM registrations WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete registration" });
    }
  });

  app.put("/api/admin/registrations/:id", (req, res) => {
    try {
      const { lead_name, email, phone, team_name, institution, department, teammates_count, teammates_names, poster_topic, esports_type, transaction_id } = req.body;
      db.prepare(`
        UPDATE registrations 
        SET lead_name = ?, email = ?, phone = ?, team_name = ?, institution = ?, department = ?, 
            teammates_count = ?, teammates_names = ?, poster_topic = ?, esports_type = ?, transaction_id = ?
        WHERE id = ?
      `).run(
        lead_name, email, phone, team_name, institution, department, 
        teammates_count, teammates_names, poster_topic, esports_type, transaction_id, 
        req.params.id
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Update registration error:", error);
      res.status(500).json({ error: "Failed to update registration" });
    }
  });

  app.get("/api/admin/export-esports/:type", (req, res) => {
    try {
      const { type } = req.params;
      const rows = db.prepare("SELECT team_name, lead_name, phone, teammates_names FROM registrations WHERE competition = 'e-sports' AND esports_type = ?").all(type);

      const formattedRows = rows.map((row: any) => ({
        "Team Name": row.team_name || 'N/A',
        "Leader Name & IGN/UID": row.lead_name || 'N/A',
        "Leader Phone No": row.phone || 'N/A',
        "Squad Members & IGN/UID": row.teammates_names || 'N/A'
      }));

      const worksheet = XLSX.utils.json_to_sheet(formattedRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `${type} Teams`);

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      const filename = `${type.replace(/\s+/g, '_').toLowerCase()}_teams.xlsx`;
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  app.get("/api/admin/export/:competition?", (req, res) => {
    try {
      const { competition } = req.params;
      let rows;
      if (competition) {
        rows = db.prepare("SELECT * FROM registrations WHERE competition = ?").all(competition);
      } else {
        rows = db.prepare("SELECT * FROM registrations").all();
      }

      const formattedRows = rows.map((row: any) => ({
        ...row,
        transaction_id: row.transaction_id || 'N/A'
      }));

      const worksheet = XLSX.utils.json_to_sheet(formattedRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Registrations");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      const filename = competition ? `registrations_${competition}.xlsx` : "all_registrations.xlsx";
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  // Admin Content Management Routes
  app.post("/api/admin/team", upload.single("photo"), (req, res) => {
    try {
      const { category, competition_id, name, phone, info } = req.body;
      const photo_url = req.file ? req.file.path : null;

      const stmt = db.prepare(`
        INSERT INTO team (category, competition_id, name, phone, info, photo_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(category, competition_id || null, name, phone, info, photo_url);
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
      res.status(500).json({ error: "Failed to add team member" });
    }
  });

  app.delete("/api/admin/team/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM team WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete team member" });
    }
  });

  app.post("/api/admin/sponsors", upload.single("logo"), (req, res) => {
    try {
      const { name, description } = req.body;
      const logo_url = req.file ? req.file.path : null;

      const stmt = db.prepare(`
        INSERT INTO sponsors (name, description, logo_url)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(name, description, logo_url);
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
      res.status(500).json({ error: "Failed to add sponsor" });
    }
  });

  app.delete("/api/admin/sponsors/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM sponsors WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete sponsor" });
    }
  });

  app.post("/api/admin/venue", (req, res) => {
    try {
      const { venue_name, venue_address } = req.body;
      const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      stmt.run('venue_name', venue_name);
      stmt.run('venue_address', venue_address);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update venue" });
    }
  });

  app.post("/api/feedback", (req, res) => {
    try {
      const { name, email, rating, comment } = req.body;
      db.prepare("INSERT INTO feedback (name, email, rating, comment) VALUES (?, ?, ?, ?)").run(name, email, rating, comment);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  });

  app.get("/api/admin/feedback", (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM feedback ORDER BY created_at DESC").all();
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  app.delete("/api/admin/feedback/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM feedback WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete feedback" });
    }
  });

  app.post("/api/admin/contacts", (req, res) => {
    try {
      const { name, role, phone, email } = req.body;
      db.prepare("INSERT INTO contacts (name, role, phone, email) VALUES (?, ?, ?, ?)").run(name, role, phone, email);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to add contact" });
    }
  });

  app.delete("/api/admin/contacts/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM contacts WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.put("/api/admin/team/:id", upload.single("photo"), (req, res) => {
    try {
      const { category, competition_id, name, phone, info } = req.body;
      const photo_url = req.file ? req.file.path : null;

      if (photo_url) {
        db.prepare("UPDATE team SET category = ?, competition_id = ?, name = ?, phone = ?, info = ?, photo_url = ? WHERE id = ?")
          .run(category, competition_id, name, phone, info, photo_url, req.params.id);
      } else {
        db.prepare("UPDATE team SET category = ?, competition_id = ?, name = ?, phone = ?, info = ? WHERE id = ?")
          .run(category, competition_id, name, phone, info, req.params.id);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update team member" });
    }
  });

  app.put("/api/admin/sponsors/:id", upload.single("logo"), (req, res) => {
    try {
      const { name, description } = req.body;
      const logo_url = req.file ? req.file.path : null;

      if (logo_url) {
        db.prepare("UPDATE sponsors SET name = ?, description = ?, logo_url = ? WHERE id = ?")
          .run(name, description, logo_url, req.params.id);
      } else {
        db.prepare("UPDATE sponsors SET name = ?, description = ? WHERE id = ?")
          .run(name, description, req.params.id);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update sponsor" });
    }
  });

  app.put("/api/admin/contacts/:id", (req, res) => {
    try {
      const { name, role, phone, email } = req.body;
      db.prepare("UPDATE contacts SET name = ?, role = ?, phone = ?, email = ? WHERE id = ?").run(name, role, phone, email, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  app.post("/api/admin/competitions", (req, res) => {
    try {
      const { id, name, description, note, date, icon, fees_individual, fees_team, max_team, color, rules, prizes, schedule } = req.body;
      const stmt = db.prepare(`
        INSERT INTO competitions (id, name, description, note, date, icon, fees_individual, fees_team, max_team, color, rules, prizes, schedule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id, name, description, note || null, date, icon, 
        fees_individual || null, fees_team || null, max_team, color, 
        JSON.stringify(rules || []), JSON.stringify(prizes || []), schedule
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to add competition:", error);
      res.status(500).json({ error: "Failed to add competition" });
    }
  });

  app.put("/api/admin/competitions/:id", (req, res) => {
    try {
      const { id, name, description, note, date, icon, fees_individual, fees_team, max_team, color, rules, prizes, schedule } = req.body;
      const stmt = db.prepare(`
        UPDATE competitions 
        SET id = ?, name = ?, description = ?, note = ?, date = ?, icon = ?, fees_individual = ?, fees_team = ?, max_team = ?, color = ?, rules = ?, prizes = ?, schedule = ?
        WHERE id = ?
      `);
      stmt.run(
        id || req.params.id, name, description, note || null, date, icon, 
        fees_individual || null, fees_team || null, max_team, color, 
        JSON.stringify(rules || []), JSON.stringify(prizes || []), schedule,
        req.params.id
      );
      
      // If ID changed, update registrations
      if (id && id !== req.params.id) {
        db.prepare("UPDATE registrations SET competition = ? WHERE competition = ?").run(id, req.params.id);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to update competition:", error);
      res.status(500).json({ error: "Failed to update competition" });
    }
  });

  app.delete("/api/admin/competitions/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM competitions WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete competition" });
    }
  });

  // Serve uploaded files
  app.use("/uploads", express.static(uploadDir));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

async function autoApprovePayment(registrationId: number, filePath: string, competition: string, teammatesCount: number, transactionId: string | null, expectedAmount: number): Promise<string> {
  try {
    if (!expectedAmount) return 'pending';

    const imageData = fs.readFileSync(filePath).toString("base64");
    const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { inlineData: { data: imageData, mimeType } },
            { text: `This is a UPI payment screenshot for a competition registration. 
              Competition: ${competition}
              Teammates: ${teammatesCount}
              Expected Amount: ${expectedAmount} INR
              Transaction ID: ${transactionId || 'Not provided'}
              
              Criteria for approval:
              1) The screenshot MUST show a payment of exactly ${expectedAmount} INR.
              2) If a Transaction ID is provided, verify if it matches the transaction ID or UTR number visible in the screenshot.
              
              Analyze the image carefully. Look for the amount paid, the status (Success/Completed), and any QR code details if visible.
              Respond with ONLY "APPROVED" if the criteria are met and the payment is successful.
              Respond with ONLY "REJECTED" if the amount is incorrect, the payment failed, or it's not a valid payment screenshot.` 
            }
          ]
        }
      ]
    });

    const result = response.text.trim().toUpperCase();
    console.log(`Auto-approval result for Reg ${registrationId}: ${result}`);

    if (result === 'APPROVED') {
      db.prepare("UPDATE registrations SET payment_status = ? WHERE id = ?").run('approved', registrationId);
      return 'approved';
    } else if (result === 'REJECTED') {
      db.prepare("UPDATE registrations SET payment_status = ? WHERE id = ?").run('rejected', registrationId);
      return 'rejected';
    }
    return 'pending';
  } catch (error) {
    console.error("Auto-approval error:", error);
    return 'pending';
  }
}

startServer();

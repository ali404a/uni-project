import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Setup Supabase
import dotenv from 'dotenv';
dotenv.config({ path: '.env' }); // load from project root

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const transcriptPath = '/Users/alialmurtadh/.gemini/antigravity/brain/76fa34f9-e595-46f6-8586-b415a80f4905/.system_generated/logs/transcript_full.jsonl';

async function run() {
  console.log("Reading transcript...");
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  let targetMessage = '';

  for (const line of lines) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT' && obj.content.includes("==Start of PDF==")) {
        targetMessage = obj.content;
        break; // found it
      }
    } catch(e) {}
  }

  if (!targetMessage) {
    console.error("Could not find the user message with the OCR text.");
    process.exit(1);
  }

  console.log("Found message! Extracting OCR data...");

  const ratesData = [];

  const pdfs = targetMessage.split("==Start of PDF==");
  
  for (let i = 1; i < pdfs.length; i++) {
    const pdfContent = pdfs[i];
    const year = i === 1 ? 2023 : 2021; 
    
    console.log(`Parsing PDF ${i} (Year ${year})...`);
    
    const contentLines = pdfContent.split('\n');
    for (const line of contentLines) {
      // Example: 1 جامعة بغداد/كلية الطب 706.28 100.90 298 احيائي مختلط
      const match = line.trim().match(/^(\d+)\s+(.+?)\s+([\d\.]+)\s+([\d\.]+)\s+(\d+)\s+([\u0600-\u06FF]+)\s+([\u0600-\u06FF]+)$/);
      if (match) {
        const [_, id, fullName, total, rate, extra, branch, gender] = match;
        const parts = fullName.split('/');
        let uniName = parts[0].trim();
        let detail = parts.slice(1).join('/'); 
        
        ratesData.push({
          rawName: fullName,
          uniName,
          detail,
          min_rate: parseFloat(rate),
          branch,
          year
        });
      }
    }
  }

  console.log(`Extracted ${ratesData.length} rate records.`);

  const { data: dbDepts, error } = await supabase.from('v_departments_full').select('id, name, branch, college_name, university_name');
  if (error) {
    console.error("DB Error:", error);
    process.exit(1);
  }
  
  console.log(`Loaded ${dbDepts.length} departments from database.`);

  let matchedCount = 0;
  const inserts = [];

  for (const r of ratesData) {
    const possibleDepts = dbDepts.filter(d => 
      d.university_name && (d.university_name.includes(r.uniName) || r.uniName.includes(d.university_name))
    );

    let matchedDept = null;
    let branchDepts = possibleDepts.filter(d => d.branch === r.branch);
    if(branchDepts.length === 0) branchDepts = possibleDepts; 

    // Keywords matching
    const keywords = r.detail.replace(/كلية|قسم|هندسة|الـ/g, '').trim().split(/[- \/]+/).filter(x=>x.length > 2);
    if (keywords.length > 0) {
      matchedDept = branchDepts.find(d => {
        const dbName = (d.name + " " + d.college_name).replace(/كلية|قسم|هندسة|الـ/g, '');
        return keywords.every(kw => dbName.includes(kw));
      });
    }

    if (!matchedDept) {
      matchedDept = branchDepts.find(d => {
        return r.rawName.includes(d.name) || (d.college_name && r.rawName.includes(d.college_name));
      });
    }

    if (matchedDept) {
      matchedCount++;
      inserts.push({
        department_id: matchedDept.id,
        year: r.year,
        branch: r.branch,
        min_rate: r.min_rate
      });
    }
  }

  console.log(`Successfully matched ${matchedCount} out of ${ratesData.length} records.`);

  if (inserts.length > 0) {
    console.log("Inserting into database...");
    const chunkSize = 500;
    for (let i = 0; i < inserts.length; i += chunkSize) {
      const chunk = inserts.slice(i, i + chunkSize);
      const { error: insErr } = await supabase.from('admission_rates').upsert(chunk, { onConflict: 'department_id, year, branch' });
      if (insErr) {
        console.error("Insert error:", insErr.message);
      } else {
        console.log(`Inserted chunk ${i/chunkSize + 1}`);
      }
    }
    console.log("Import completed!");
  }
}

run().catch(console.error);

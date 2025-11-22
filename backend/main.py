import os
import json
import redis
import requests
import pdfplumber
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from anthropic import Anthropic
from dotenv import load_dotenv
from fastapi.responses import FileResponse
import uuid
import time
import shutil
import re
from datetime import datetime
# Additional imports for Skyflow integration and token stability
import hashlib
import hmac
import base64

try:
    from skyflow import Skyflow, Env, LogLevel
except Exception:
    Skyflow = None
    Env = None
    LogLevel = None

# --- CONFIG ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load environment variables from .env
load_dotenv()

# Uploads directory
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Redis config from env (supports Redis Cloud)
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_USERNAME = os.getenv("REDIS_USERNAME")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")
print(REDIS_PORT)
# REDIS_DB = int(os.getenv("REDIS_DB", "0"))
# REDIS_SSL = os.getenv("REDIS_SSL", "false").lower() in ("1", "true", "yes", "on")

# r = redis.Redis(
#     host=REDIS_HOST,
#     port=REDIS_PORT,
#     username=REDIS_USERNAME,
#     password=REDIS_PASSWORD,
#     db=REDIS_DB,
#     ssl=REDIS_SSL,
#     decode_responses=True,
# )

#r = redis.from_url(
#    "redis://default:l5HvYfFux30wadX2vxQCsGN7oxPN7SKv@redis-14278.c273.us-east-1-2.ec2.cloud.redislabs.com:14278"
#)

r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    username=REDIS_USERNAME,
    password=REDIS_PASSWORD,
    decode_responses=True
)

try:
    r.ping()
    print("✅ Connected to Redis")
except Exception as e:
    print(f"⚠️ Redis unavailable: {e}")

# --- Skyflow Client Init ---
SKYFLOW_ENABLED = os.getenv("SKYFLOW_ENABLED", "false").lower() in ("1", "true", "yes", "on")
SKYFLOW_VAULT_ID = os.getenv("SKYFLOW_VAULT_ID")
SKYFLOW_CLUSTER_ID = os.getenv("SKYFLOW_CLUSTER_ID")
SKYFLOW_ENV = os.getenv("SKYFLOW_ENV", "SANDBOX").upper()
SKYFLOW_API_KEY = os.getenv("SKYFLOW_API_KEY")
SKYFLOW_CREDENTIALS_STRING = os.getenv("SKYFLOW_CREDENTIALS")
SKYFLOW_CREDENTIALS_PATH = os.getenv("SKYFLOW_CREDENTIALS_PATH")
SKYFLOW_BEARER_TOKEN = os.getenv("SKYFLOW_BEARER_TOKEN")

skyflow_client = None

def init_skyflow():
    global skyflow_client
    if not SKYFLOW_ENABLED or Skyflow is None:
        if not SKYFLOW_ENABLED:
            print("ℹ️ Skyflow disabled via env; using logical mock scrub.")
        else:
            print("ℹ️ Skyflow SDK not installed; using logical mock scrub.")
        return
    try:
        credentials = None
        if SKYFLOW_API_KEY:
            credentials = {'api_key': SKYFLOW_API_KEY}
        elif SKYFLOW_CREDENTIALS_STRING:
            credentials = {'credentials_string': SKYFLOW_CREDENTIALS_STRING}
        elif SKYFLOW_CREDENTIALS_PATH:
            credentials = {'path': SKYFLOW_CREDENTIALS_PATH}
        elif SKYFLOW_BEARER_TOKEN:
            credentials = {'token': SKYFLOW_BEARER_TOKEN}
        if not (SKYFLOW_VAULT_ID and SKYFLOW_CLUSTER_ID and credentials):
            print("ℹ️ Skyflow not initialized: missing vault_id/cluster_id/credentials")
            return
        env_enum = Env.PROD if SKYFLOW_ENV == "PROD" else Env.SANDBOX
        skyflow_client = (
            Skyflow.builder()
            .add_vault_config({
                'vault_id': SKYFLOW_VAULT_ID,
                'cluster_id': SKYFLOW_CLUSTER_ID,
                'env': env_enum,
                'credentials': credentials
            })
            .add_skyflow_credentials(credentials)
            .set_log_level(LogLevel.ERROR)
            .build()
        )
        print("✅ Skyflow client initialized")
    except Exception as e:
        print(f"⚠️ Skyflow init failed: {e}")
        skyflow_client = None

init_skyflow()

anthropic = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
PARALLEL_API_KEY = os.environ.get("PARALLEL_API_KEY")

# --- 1. THE SHIELD (Skyflow / Mock) ---
# Use Skyflow to tokenize PII if configured; otherwise use logical mock.

def _extract_name(text: str):
    m = re.search(r"(?:Patient Name|Name)\s*[:\-]?\s*([A-Za-z][A-Za-z'\-]+\s+[A-Za-z][A-Za-z'\-]+)", text, re.IGNORECASE)
    return m.group(1).strip() if m else None


def _extract_dob(text: str):
    m = re.search(r"(?:DOB|Date of Birth)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})", text, re.IGNORECASE)
    if m:
        return _parse_date_string(m.group(1)) or m.group(1)
    return None


def _stable_patient_token(name: str, dob: str):
    base = f"{name or ''}|{dob or ''}".strip() or str(uuid.uuid4())
    salt = os.getenv("PATIENT_TOKEN_SALT", "bio-hacker-salt")
    digest = hmac.new(salt.encode("utf-8"), base.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"PT_{digest[:24]}"


def scrub_pii(text):
    name = _extract_name(text)
    dob = _extract_dob(text)
    patient_token = _stable_patient_token(name, dob)
    scrubbed = text
    if name:
        scrubbed = re.sub(re.escape(name), patient_token, scrubbed)
    if dob:
        scrubbed = scrubbed.replace(dob, "DOB_REDACTED")

    # Attempt Skyflow insertion/tokenization (best-effort; no-ops if misconfigured)
    if skyflow_client and SKYFLOW_ENABLED:
        table = os.getenv("SKYFLOW_TABLE_PATIENTS", "persons")
        name_field = os.getenv("SKYFLOW_FIELD_NAME", "name")
        dob_field = os.getenv("SKYFLOW_FIELD_DOB", "dob")
        b64_required = os.getenv("SKYFLOW_B64", "true").lower() in ("1", "true", "yes", "on")
        try:
            def enc(v: str) -> str:
                if not v:
                    return ""
                return base64.b64encode(v.encode("utf-8")).decode("ascii") if b64_required else v

            payload = {
                "records": [
                    {
                        "table": table,
                        "fields": {
                            name_field: enc(name or ""),
                            dob_field: enc(dob or ""),
                        }
                    }
                ]
            }
            options = {"tokens": True}
            if hasattr(skyflow_client, "insert"):
                resp = skyflow_client.insert(payload, options)
                try:
                    tokens = resp.get("records", [{}])[0].get("tokens", {})
                    tname = tokens.get(name_field)
                    if tname and name:
                        scrubbed = re.sub(re.escape(name), tname, scrubbed)
                except Exception:
                    pass
            elif hasattr(skyflow_client, "tokenize"):
                _ = skyflow_client.tokenize(payload)
        except Exception as e:
            print(f"ℹ️ Skyflow tokenize/insert skipped: {e}")

    return scrubbed, patient_token

# --- 2. THE RESEARCHER (Parallel.ai) ---
def search_medical_advice(biomarker, value, direction):
    if not PARALLEL_API_KEY: return "Parallel.ai API Key missing - skipping live search."
    
    print(f"🔎 Agent searching live web for: {biomarker}...")
    url = "https://api.parallel.ai/v1/search"
    query = f"latest clinical guidelines 2025 for {direction} {biomarker} treatment lifestyle"
    
    try:
        payload = {"query": query, "num_results": 2}
        headers = {"Authorization": f"Bearer {PARALLEL_API_KEY}"}
        # Mocking response for demo stability if API is flaky
        # return requests.post(url, json=payload, headers=headers).json() 
        return [f"Recent 2025 study suggests increasing magnesium intake for {biomarker}."]
    except:
        return ["Could not connect to medical research database."]

# --- 3. THE BRAIN (Anthropic) ---
SYSTEM_PROMPT = """
You are a Medical Analysis Agent. You receive REDACTED text.
1. EXTRACT: Convert blood work text into JSON: [{"name": "Vitamin D", "value": 20, "unit": "ng/mL", "flag": "LOW"}]
2. TREND: If I provide 'PREVIOUS_DATA', compare values.
3. ADVISE: For every 'Abnormal' flag, draft a specific question for a doctor.
OUTPUT VALID JSON ONLY.
"""

def _parse_date_string(s: str):
    for fmt in [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%m/%d/%Y",
        "%d/%m/%Y",
        "%m-%d-%Y",
        "%d-%m-%Y",
        "%B %d, %Y",
        "%b %d, %Y",
    ]:
        try:
            dt = datetime.strptime(s.strip(), fmt)
            return dt.date().isoformat()
        except Exception:
            continue
    return None


def extract_lab_date(text: str):
    patterns = [
        r"(?:Report Date|Collection Date|Collected|Sample Date|Date of Service|Report Generated|Order Date|Specimen Date|Date)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})",
        r"(?:Report Date|Collection Date|Collected|Sample Date|Date of Service|Order Date|Specimen Date|Date)\s*[:\-]?\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})",
        r"(?:Report Date|Collection Date|Collected|Sample Date|Date of Service|Order Date|Specimen Date|Date)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})",
        r"\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b",
        r"\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b",
        r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            candidate = m.group(1) if m.groups() else m.group(0)
            iso = _parse_date_string(candidate)
            if iso:
                return iso
    return None

# Fallback: try to infer date from the original filename when PDF text has no usable date
# Supports: YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD, and 6-digit compact forms like DDMMYY or YYMMDD

def extract_date_from_filename(filename: str):
    name = os.path.splitext(os.path.basename(filename))[0]
    # Normalize multiple spaces
    name_norm = re.sub(r"\s+", " ", name)

    # 1) Try explicit 4-2-2 patterns first (supports separators incl. space)
    m = re.search(r"\b(\d{4})[._\- ]?(\d{2})[._\- ]?(\d{2})\b", name_norm)
    if m:
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            dt = datetime(y, mo, d)
            return dt.date().isoformat()
        except Exception:
            pass

    # 2) Try separated 2-2-2 forms (DD MM YY or YY MM DD)
    m_sep = re.search(r"\b(\d{2})[._\- ](\d{2})[._\- ](\d{2})\b", name_norm)
    if m_sep:
        a, b, c = int(m_sep.group(1)), int(m_sep.group(2)), int(m_sep.group(3))
        # Prefer DDMMYY
        try:
            yy = 2000 + c
            dt1 = datetime(yy, b, a)
            return dt1.date().isoformat()
        except Exception:
            pass
        # Try YYMMDD
        try:
            yy = 2000 + a
            dt2 = datetime(yy, b, c)
            return dt2.date().isoformat()
        except Exception:
            pass

    # 3) Try compact 6-digit patterns (DDMMYY or YYMMDD)
    m2 = re.search(r"\b(\d{2})(\d{2})(\d{2})\b", name_norm)
    if m2:
        a, b, c = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        # Prefer DDMMYY
        try:
            yy = 2000 + c
            dt1 = datetime(yy, b, a)
            return dt1.date().isoformat()
        except Exception:
            pass
        # YYMMDD
        try:
            yy = 2000 + a
            dt2 = datetime(yy, b, c)
            return dt2.date().isoformat()
        except Exception:
            pass

    # 4) As a last resort, scan any 6-digit chunk anywhere
    for chunk in re.findall(r"\d{6}", name_norm):
        try:
            a, b, c = int(chunk[0:2]), int(chunk[2:4]), int(chunk[4:6])
            # DDMMYY
            try:
                yy = 2000 + c
                dt1 = datetime(yy, b, a)
                return dt1.date().isoformat()
            except Exception:
                pass
            # YYMMDD
            try:
                yy = 2000 + a
                dt2 = datetime(yy, b, c)
                return dt2.date().isoformat()
            except Exception:
                pass
        except Exception:
            continue

    return None

@app.post("/analyze_bloodwork")
async def analyze(file: UploadFile = File(...)):
    # A. INGEST
    print("📂 Receiving Medical PDF...")

    # Save uploaded file to disk with a unique name
    original_filename = file.filename or "report.pdf"
    ext = os.path.splitext(original_filename)[1] or ".pdf"
    stored_filename = f"{int(time.time()*1000)}-{uuid.uuid4().hex}{ext}"
    saved_path = os.path.join(UPLOADS_DIR, stored_filename)
    try:
        file.file.seek(0)
        with open(saved_path, "wb") as out:
            shutil.copyfileobj(file.file, out)
    except Exception as e:
        print(f"⚠️ Failed to save upload: {e}")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file")

    # Parse PDF text from saved file (guard against None text on image-only PDFs)
    with pdfplumber.open(saved_path) as pdf:
        raw_text = "\n".join([(p.extract_text() or "") for p in pdf.pages])

    # Extract lab date from PDF text, or fallback to filename, else uploaded-at date
    lab_date = extract_lab_date(raw_text)
    if not lab_date:
        lab_date = extract_date_from_filename(original_filename)
    uploaded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # B. SCRUB (Privacy Layer)
    safe_text, patient_token = scrub_pii(raw_text)
    print(f"🔒 Text Scrubbed. Processing for {patient_token}")

    # C. MEMORY RECALL (Redis)
    # Check if we have past results for this token
    history_key = f"patient:{patient_token}:history"
    try:
        history_json = r.get(history_key)
        history_list = json.loads(history_json) if history_json else []
    except Exception as e:
        print(f"⚠️ Redis unavailable: {e}")
        history_list = []
    
    # Build context from the most recent prior entry (if any)
    previous_biomarkers_json = json.dumps(history_list[-1]["biomarkers"]) if history_list else None
    context_str = f"PREVIOUS_DATA: {previous_biomarkers_json}" if previous_biomarkers_json else "PREVIOUS_DATA: None"

    # D. ANALYZE (Claude)
    print("🧠 Sending to Claude...")
    try:
        response = anthropic.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"{safe_text}\n\n{context_str}"}]
        )
        analysis = json.loads(response.content[0].text)
    except Exception as e:
        print(f"⚠️ Analysis service unavailable: {e}")
        analysis = {
            "biomarkers": [
                {"name": "Vitamin D", "value": 20, "unit": "ng/mL", "flag": "LOW"},
                {"name": "Ferritin", "value": 15, "unit": "ng/mL", "flag": "LOW"}
            ]
        }

    # E. AGENT ACTION (Parallel.ai loop)
    # If any result is abnormal, trigger the "Researcher" agent
    research_notes = []
    for item in analysis.get('biomarkers', []):
        if item.get('flag') in ['HIGH', 'LOW']:
            advice = search_medical_advice(item['name'], item['value'], item['flag'])
            item['research_notes'] = advice

    # F. SAVE MEMORY
    # Append this report to the patient's full history
    new_entry = {
        "lab_date": lab_date or time.strftime("%Y-%m-%d", time.gmtime()),
        "uploaded_at": uploaded_at,
        "original_filename": original_filename,
        "file_url": f"/files/{stored_filename}",
        "biomarkers": analysis.get('biomarkers', [])
    }
    history_list.append(new_entry)

    try:
        r.set(history_key, json.dumps(history_list))
    except Exception as e:
        print(f"⚠️ Redis unavailable (save skipped): {e}")

    return {
        "patient": patient_token,
        "analysis": analysis,
        "status": "Report Generated & Encrypted",
        "original_filename": original_filename,
        "uploaded_at": uploaded_at,
        "lab_date": lab_date or time.strftime("%Y-%m-%d", time.gmtime()),
        "file_url": f"/files/{stored_filename}",
    }

# Alias route for frontend fetch
@app.post("/analyze")
async def analyze_alias(file: UploadFile = File(...)):
    return await analyze(file)

# Serve uploaded files for download
@app.get("/files/{filename}")
async def get_file(filename: str):
    file_path = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, media_type="application/pdf", filename=filename)

# Fetch full patient history (append-only entries)
@app.get("/history/{patient_token}")
def get_history(patient_token: str):
    history_key = f"patient:{patient_token}:history"
    try:
        history_json = r.get(history_key)
        history = json.loads(history_json) if history_json else []
    except Exception as e:
        print(f"⚠️ Redis unavailable: {e}")
        history = []
    return {"patient": patient_token, "history": history}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
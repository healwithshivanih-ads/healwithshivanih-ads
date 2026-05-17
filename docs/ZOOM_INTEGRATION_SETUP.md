# Zoom Cloud Recording → fm-coach Transcript Integration

When a Zoom session ends + Zoom finishes auto-transcribing the recording,
Zoom POSTs to `https://intake.theochretree.com/api/zoom-webhook`. fm-coach:

1. Validates the webhook signature
2. Downloads the transcript (`.vtt`) + audio file (`.m4a`) via the Zoom API
3. Matches the meeting → fm-coach client by host email / attendee email / scheduled cal.com booking
4. Creates a `quick_note` session YAML for the client with the full transcript
5. Runs AI extraction on the transcript: symptoms, supplements, lab values, measurements, medications
6. Merges the extracted data into the client's structured record (with `requires_review: true` flag)

Coach reviews the auto-extracted data on the client's Overview page and accepts / edits / discards.

## One-time coach setup (~15 min)

### 1. Confirm Zoom plan + Cloud Recording

- Zoom dashboard → **Account Management → Account Settings → Recording**
- Toggle ON: **Cloud Recording**
- Toggle ON: **Audio transcript** (under "Advanced cloud recording settings")
- Toggle ON: **Automatic recording** — set to "Record on the local computer" → switch to **"Record in the cloud"** for cal.com video sessions

If you don't have these toggles, you're still on free Zoom — upgrade to **Pro** (or higher) at https://zoom.us/billing. Cloud Recording is Pro-and-above.

### 2. Create a Server-to-Server OAuth app

- Go to https://marketplace.zoom.us/develop/create
- Click **"Server-to-Server OAuth"** → **Create**
- Name: `fm-coach transcript receiver`
- Fill in **Information** section:
  - Company name: `Heal with Shivani` / `The Ochre Tree`
  - Developer contact: `shivanihari@gmail.com`
- **Activation** tab → **Add Scopes**:
  - `cloud_recording:read:list_user_recordings:admin`
  - `cloud_recording:read:recording:admin`
  - `meeting:read:meeting:admin` (helpful for host email lookup)
  - `user:read:user:admin` (for host info)
- **Event Subscriptions** tab → **+ Add Event Subscription**:
  - Subscription Name: `recording-completed`
  - Event notification endpoint URL: `https://intake.theochretree.com/api/zoom-webhook`
  - Events to subscribe to:
    - **Recording → All Recordings have completed** (`recording.completed`)
    - **Recording → Transcript files have completed** (`recording.transcript_completed`)
  - Click **Save**
  - Zoom will display a **Secret Token** + a **Verification Token** — copy both
- **Activate** the app

### 3. Add Zoom credentials to fm-coach

Edit `/Users/shivani/code/healwithshivanih-ads/fm-database-web/.env.local`:

```
ZOOM_ACCOUNT_ID=<from your S2S app's App Credentials tab>
ZOOM_CLIENT_ID=<from App Credentials tab>
ZOOM_CLIENT_SECRET=<from App Credentials tab>
ZOOM_WEBHOOK_SECRET_TOKEN=<from Feature → Event Subscriptions tab, "Secret Token">
```

Then restart pm2:
```
cd /Users/shivani/code/healwithshivanih-ads/fm-database-web
./node_modules/.bin/pm2 restart fm-coach --update-env
```

### 4. Add same credentials to Fly (so Fly's public webhook also works)

```
flyctl secrets set \
  ZOOM_ACCOUNT_ID=<value> \
  ZOOM_CLIENT_ID=<value> \
  ZOOM_CLIENT_SECRET=<value> \
  ZOOM_WEBHOOK_SECRET_TOKEN=<value> \
  -a theochretree-coach
```

Fly auto-restarts after secret update.

### 5. Validate the endpoint with Zoom

- Back in the **Event Subscriptions** tab → click **Validate URL**
- Zoom sends a `endpoint.url_validation` challenge → fm-coach responds with the encrypted token
- You'll see "✓ Endpoint validated" if everything is wired correctly

### 6. (Optional but recommended) Set cal.com video to Zoom

If your event types use Daily.co (cal.com's default), switch to Zoom so recordings flow through the integration:

- Cal.com → **Apps** → **Zoom Video** → **Install** (OAuth in once)
- For each event type (Discovery / Programme Intake / Coaching):
  - **Event Type Settings** → **Location** → change from "Cal Video" to "Zoom"

## How a session flows after setup

```
Client books cal.com session → confirmed for Tuesday 4pm
                              ↓
4:00 PM:  Coach + client join Zoom call
4:35 PM:  Call ends, Zoom uploads recording to Cloud
4:40 PM:  Zoom auto-transcribes (audio_transcript scope)
4:42 PM:  Zoom POSTs recording.transcript_completed to fm-coach
                              ↓
fm-coach validates signature
                              ↓
Downloads .vtt + .m4a using OAuth S2S token
                              ↓
Matches host/attendee email → cl-008 (Sudarshan Karnad)
                              ↓
Creates ~/fm-plans/clients/cl-008/sessions/<date>-NNN-zoom-transcript.yaml
                              ↓
Runs Anthropic call: symptoms, supplements, labs, measurements extracted
                              ↓
Merges into client.yaml (additive, requires_review: true)
                              ↓
Coach dashboard shows "🎥 New transcript from Sudarshan + 3 fields to review"
```

## Troubleshooting

**"Validate URL" fails:**
- Endpoint must be HTTPS + reachable (test by visiting `https://intake.theochretree.com/api/zoom-webhook` in a browser — should return a GET-handler JSON)
- ZOOM_WEBHOOK_SECRET_TOKEN must match exactly (no leading/trailing whitespace)

**Recording lands but transcript is empty:**
- Zoom takes 5-15 min to transcribe after the recording finishes
- Two events fire: `recording.completed` (audio ready) and `recording.transcript_completed` (transcript ready)
- fm-coach waits for the transcript event before processing

**Transcript lands but no client match:**
- Lands in `~/fm-plans/_zoom_unmatched.yaml`
- Check whether the attendee email on the Zoom meeting matches the client's `email` field in `client.yaml`
- If client registered with a different email than cal.com → manually move the record (same pattern as `_calcom_unmatched.yaml`)

**Recording older than 30 days:**
- Zoom defaults to 30-day Cloud Recording retention. After that the file is deleted.
- fm-coach stores its own copy on `~/fm-plans/`, so transcripts persist even if Zoom deletes the source.

## Cost estimate

- Zoom Pro: ~$15/month flat (no per-meeting fee, no per-minute storage fee)
- Anthropic extraction: ~$0.05/session at 60 min (Haiku call on transcript chunks)
- Storage: each .m4a recording is ~10-30 MB; transcripts are <50 KB. ~500 MB / year at typical 5 sessions/week.

## Security note

- Recordings + transcripts contain PHI. They're stored in `~/fm-plans/clients/<id>/recordings/` which is part of the Mutagen-synced PHI store (private to coach, not pushed to git).
- Zoom OAuth scopes are read-only — fm-coach can't start/end meetings, only read recordings.
- The webhook secret prevents spoofed events.

# ✅ Shared SSH Key Setup Complete

## What Was Done

### 1. Generated Shared Team Key
- **Location**: `.ssh/provision_team_key` (private key)
- **Public Key**: Added to RunPod's `~/.ssh/authorized_keys`
- **Fingerprint**: `SHA256:jHpQ5vnSu3QSBkuf48MB8KiXcPxVpBJbqz8k1VT4OcY`

### 2. Updated Configuration
- ✅ Backend `.env` now uses `.ssh/provision_team_key`
- ✅ Backend `.env.example` updated with correct key path
- ✅ SSH client resolves relative paths automatically
- ✅ `.gitignore` excludes `.ssh/` directory

### 3. Created Team Documentation
- ✅ `RUNPOD_SETUP.md` - Complete teammate setup guide
- ✅ `TEAM_SHARED_KEY_INSTRUCTIONS.md` - Key distribution instructions

### 4. Tested & Verified
```bash
# Tested from project root
ssh -i .ssh/provision_team_key root@216.81.248.127 -p 10749 "echo OK"
# Result: OK ✅

# Verified GPU models loaded
curl via SSH showed all models (yolo, yolo_pose, tracknet) loaded on cuda:0 ✅
```

### 5. UI Update
- ✅ Removed "Players" tab from game viewer (redundant with "Pose")
- ✅ Tabs now: Pose, Track, Court, Analytics, AI

---

## For You (Team Lead)

### Share the Key with Teammates

**Option 1: Secure Direct Message** (Recommended)
```bash
# Copy the private key
cat .ssh/provision_team_key
```
Send via Slack/Discord DM (NEVER in public channels)

**Option 2: Shared Drive**
Upload `.ssh/provision_team_key` to Google Drive/Dropbox (private folder)

**Option 3: Password Manager**
Add to 1Password/LastPass shared vault

### What to Share
1. **Private key file**: `.ssh/provision_team_key`
2. **Setup guide**: `RUNPOD_SETUP.md`
3. **Supabase credentials** (URL + keys from backend/.env)

---

## For Teammates

See `RUNPOD_SETUP.md` for complete setup instructions. Quick version:

1. **Save key to project**:
   ```bash
   mkdir -p .ssh
   # Paste key content into .ssh/provision_team_key
   chmod 600 .ssh/provision_team_key
   ```

2. **Update backend/.env**:
   ```bash
   SSH_KEY_FILE=.ssh/provision_team_key
   SSH_HOST=216.81.248.127
   SSH_PORT=10749
   ```

3. **Test**:
   ```bash
   ssh -i .ssh/provision_team_key root@216.81.248.127 -p 10749 "echo OK"
   ```

---

## Security Notes

⚠️ **IMPORTANT**:
- Key is in `.gitignore` - will NOT be committed
- Only share with ProVision team members
- Keep key permissions at `600` (owner read/write only)
- Don't restart RunPod server or modify GPU files

---

## Technical Details

### RunPod Info
- **Host**: 216.81.248.127:10749
- **GPU**: NVIDIA A100-SXM4-80GB (80GB VRAM)
- **Models**: TrackNet, YOLO, YOLO-Pose (all on GPU)
- **Model Server**: http://localhost:8765

### Backend Integration
- SSH client in `backend/src/ssh_client.py`
- Config in `backend/src/engines/remote_run.py`
- Resolves relative paths from project root
- Also supports `SSH_KEY_BASE64` for production deployment

### Key Benefits
✅ One key for everyone (no manual key management)  
✅ Easy teammate onboarding (5-minute setup)  
✅ Secure (never committed to git)  
✅ Works from any teammate's machine  

---

**Setup Date**: February 6, 2026  
**Key Type**: ED25519 (modern, secure)  
**Access**: Shared among ProVision team  

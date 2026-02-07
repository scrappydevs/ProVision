# ProVision - RunPod GPU Setup for Teammates

## Overview

Your team shares **one RunPod A100 GPU instance** and **one SSH key** for all AI processing. Super simple setup!

---

## 🚀 Quick Setup (5 Minutes)

### Option A: Base64 Key (Easier - Recommended)

Just update your `backend/.env`:

```bash
# RunPod SSH Configuration
SSH_HOST=216.81.248.127
SSH_PORT=10749
SSH_USER=root
SSH_KEY_BASE64=LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUFNd0FBQUF0emMyZ3RaVwpReU5UVXhPUUFBQUNEOWptMjNJZzM5cVJiNGdnWkNZVlVLRlFGcjZOWWI1RlpES3hGUStzKzEzZ0FBQUppOGYwQkx2SDlBClN3QUFBQXR6YzJndFpXUXlOVFV4T1FBQUFDRDlqbTIzSWczOXFSYjRnZ1pDWVZVS0ZRRnI2TlliNUZaREt4RlErcysxM2cKQUFBRUFRWmpwdDlzTGo4NW9JUXM0MzUvczBDZUp6TnlhWWJkaGdxWG9TaHBMTHkvMk9iYmNpRGYycEZ2aUNCa0poVlFvVgpBV3ZvMWh2a1ZrTXJFVkQ2ejdYZUFBQUFGWEJ5YjNacGMybHZiaTEwWldGdFFITm9ZWEpsWkE9PQotLS0tLUVORCBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0K
```

**✅ Done!** No files to create, just copy/paste the key into your `.env`.

---

### Option B: SSH Key File (Alternative)

If you prefer using a key file:

**Step 1: Get the Shared SSH Key**

Ask your team lead (Julian) for the **shared SSH key file**: `provision_team_key`

Save it in your project:
```bash
# In your ProVision folder
mkdir -p .ssh
# Paste the key content into .ssh/provision_team_key
chmod 600 .ssh/provision_team_key
```

**Step 2: Update Your Backend Config**

In your `backend/.env` file:

```bash
# RunPod SSH Configuration
SSH_HOST=216.81.248.127
SSH_PORT=10749
SSH_USER=root
SSH_KEY_FILE=.ssh/provision_team_key
```

---

### Test Connection (Both Options)

```bash
ssh -i .ssh/provision_team_key root@216.81.248.127 -p 10749 "echo 'Connected!'"
```

You should see: `Connected!`

### Step 3: Update Your Backend Config

In your `backend/.env` file:

```bash
# RunPod SSH Configuration
SSH_HOST=216.81.248.127
SSH_PORT=10749
SSH_USER=root
SSH_KEY_FILE=.ssh/provision_team_key

# Model Server (on RunPod)
MODEL_SERVER_HOST=localhost
MODEL_SERVER_PORT=8765

# Remote Paths
REMOTE_BASE_DIR=/workspace/provision/data
REMOTE_VIDEO_DIR=/workspace/provision/data/videos
REMOTE_RESULTS_DIR=/workspace/provision/data/results
```

**⚠️ Use relative path `.ssh/provision_team_key` (not absolute path with your username)**

### Test GPU Access (Both Options)

```bash
# Option A (base64): Backend auto-handles the key
# Option B (file):
ssh -i .ssh/provision_team_key root@216.81.248.127 -p 10749 \
  "curl -s http://localhost:8765/health"
```

You should see all models loaded on GPU:
```json
{
  "status": "ok",
  "models": {
    "yolo": {"loaded": true},
    "yolo_pose": {"loaded": true},
    "tracknet": {"loaded": true}
  },
  "device": "cuda:0"
}
```

### ✅ Done!

You're ready to use the shared GPU! Upload videos through ProVision and ball tracking will automatically use the GPU.

---

## 🎮 How It Works

When you run ProVision locally:

```
Your Computer          Shared RunPod GPU
┌─────────────┐       ┌──────────────────┐
│ Frontend    │       │                  │
│ (port 3000) │       │  TrackNet        │
└──────┬──────┘       │  YOLO            │
       │              │  YOLO-Pose       │
┌──────┴──────┐  SSH  │                  │
│ Backend     ├──────>│  A100-80GB GPU   │
│ (port 8000) │  (shared key)            │
└─────────────┘       └──────────────────┘
```

Everyone uses the same:
- ✅ SSH key (for GPU access)
- ✅ Supabase database (for data)
- ✅ RunPod GPU (for AI processing)

Everyone has their own:
- 🏠 Local dev servers (frontend + backend)
- 🏠 Git branches (for code changes)

---

## 🔧 Troubleshooting

### Error: "Permission denied"

**Problem**: Key file permissions too open

**Solution**:
```bash
chmod 600 .ssh/provision_team_key
```

### Error: "Host key verification failed"

**Problem**: RunPod's host key not in known_hosts

**Solution**:
```bash
ssh-keyscan -p 10749 216.81.248.127 >> ~/.ssh/known_hosts
```

### Error: "Connection refused"

**Problem**: Wrong host/port or RunPod is down

**Solution**: Check with team lead

---

## 📊 RunPod Specs

- **GPU**: NVIDIA A100-SXM4-80GB
- **Memory**: 85 GB
- **Models**: TrackNet, YOLO, YOLO-Pose (all on GPU)
- **Access**: Shared SSH key (all teammates)
- **Uptime**: 24/7 (usually)

---

## ⚠️ Important

### DO:
✅ Keep the SSH key file secure  
✅ Add `.ssh/` to `.gitignore` (already done)  
✅ Use the shared GPU responsibly  

### DON'T:
❌ Commit the SSH key to git  
❌ Share the key outside the team  
❌ Restart the RunPod server  
❌ Modify GPU server files  

---

## 🆘 Need Help?

**Team Lead**: Julian Ng-Thow-Hing (jngthowh@andrew.cmu.edu)

**Quick Test**:
```bash
# From your ProVision project folder
ssh -i .ssh/provision_team_key root@216.81.248.127 -p 10749 \
  "curl -s http://localhost:8765/health | python3 -m json.tool"
```

---

**That's it! You're ready to use the shared GPU.** 🎾🚀

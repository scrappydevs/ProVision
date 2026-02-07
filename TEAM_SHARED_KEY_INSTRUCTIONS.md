# 🔑 Shared SSH Key Distribution

## For Team Lead (Julian)

Share this file (`provision_team_key`) with your teammates securely:

**File Location**: `.ssh/provision_team_key`

### Option 1: Slack/Discord (Secure DM)
```bash
# On your machine:
cat .ssh/provision_team_key
```
Copy and send via direct message (never in public channels)

### Option 2: Shared Drive (Google Drive, Dropbox)
Upload `.ssh/provision_team_key` to a private shared folder

### Option 3: Password Manager (1Password, LastPass)
Add as secure note in shared team vault

---

## For Teammates

Once you receive the key file:

1. **Save to your ProVision project**:
   ```bash
   cd ~/path/to/ProVision
   mkdir -p .ssh
   # Paste key content into .ssh/provision_team_key
   chmod 600 .ssh/provision_team_key
   ```

2. **Test it works**:
   ```bash
   ssh -i .ssh/provision_team_key root@216.81.248.127 -p 10749 "echo OK"
   ```

3. **Update backend/.env**:
   ```bash
   SSH_KEY_FILE=.ssh/provision_team_key
   ```

4. **Done!** Follow the rest of RUNPOD_SETUP.md

---

## Security Notes

⚠️ **NEVER commit this key to git** (already in .gitignore)  
⚠️ **Keep file permissions**: `chmod 600 .ssh/provision_team_key`  
⚠️ **Don't share outside team**  

---

**Questions?** Ask Julian (jngthowh@andrew.cmu.edu)

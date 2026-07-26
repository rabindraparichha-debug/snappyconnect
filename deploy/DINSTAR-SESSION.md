# Dinstar configuration session — instructions for the on-site person

The Dinstar GSM gateway (192.168.3.26) is only reachable from the office LAN.
This creates a **temporary, restricted tunnel** so it can be configured remotely.

The key below can do exactly one thing: forward the Dinstar's web page to the
VPS. It cannot open a shell, reach any other device, or access anything else on
the network. Close the terminal (or press Ctrl+C) and the access ends.

## What the on-site person does

1. Be on the office network (same LAN as the Dinstar).
2. Save the key file `dinstar-tunnel-key` to their computer.
3. Run **one** command and leave the window open for the session:

**macOS / Linux**
```bash
chmod 600 dinstar-tunnel-key
ssh -i dinstar-tunnel-key -N -R 127.0.0.1:8088:192.168.3.26:80 dinstarlink@145.223.18.237
```

**Windows (PowerShell, built-in OpenSSH)**
```powershell
ssh -i dinstar-tunnel-key -N -R 127.0.0.1:8088:192.168.3.26:80 dinstarlink@145.223.18.237
```

Nothing prints when it works — that is success. Keep the window open.

4. Tell us it is running, and give us the Dinstar admin username/password
   (or stay available to type it themselves — see below).

## Notes

- If the Dinstar's web UI is on HTTPS or a non-standard port, change `:80` in
  the command (e.g. `:443` or `:8080`).
- Verify from the VPS with: `curl -sI http://127.0.0.1:8088 | head -1`
- **Credentials:** the person can keep them private — they can be the one to log
  in through the tunnel first, after which the configuration screens are driven
  remotely. Passwords should never be pasted into chat.
- When the session is finished, revoke access entirely on the VPS:
  ```bash
  userdel -r dinstarlink
  ```

## What gets configured in that session

1. **Outbound SIM pinning** — routing rules mapping dial prefix `8<N>` to SIM
   port N, so a recruiter tagged `SIMGROUP=N` always calls out on that SIM.
2. **Inbound port tagging** — each SIM port sends its incoming calls to the UCM
   with a distinct prefix, so the UCM can route SIM N to ring group `600N`
   (that SIM's team) instead of the everyone-group 6000.
3. **SIM status check** — confirm all 8 SIMs are inserted, registered to the
   carrier, and enabled for the concurrency the recruiters need.

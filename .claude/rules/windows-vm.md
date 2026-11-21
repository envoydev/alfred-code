# Everything a run makes in the Windows VM lives under C:\Claude-MacOs

- A run that works in a Windows VM from macOS - `prlctl exec`, a remote shell, a test or a gate leg - keeps every file it makes or copies there under `C:\Claude-MacOs`, on the guest's own disk and not on the host shared folder. Why: one place for all the data Claude uses in the VM, so it is found, reused and removed in one spot (the user's request, 2026-11-20).
- Each run works in `C:\Claude-MacOs\<repo>\<run>\`: `<repo>` is the name of the repo folder the session runs in, and `<run>` a short id of 8 characters or fewer that the run picks and records, since Windows paths stop at 260 characters. Create the folders where they are missing.
- Its clones, bundles, logs, outputs and scratch files go there, and so do its project dependencies.
- What later runs reuse goes in `C:\Claude-MacOs\<repo>\shared\`: a clone kept across runs, a package cache (`npm_config_cache`, `NUGET_PACKAGES`). The `cleanup` rule leaves it.
- Set `TEMP` and `TMP` to `<run>\tmp` in the environment of the run's own commands only - never with `setx` or in the registry. Why: the VM's own temp folder is cleaned by no one.
- The host shared folder (`\\Mac\<share>`) only carries files between the Mac and the VM. Put what the run passes through it in `\\Mac\<share>\Claude-MacOs\<repo>\<run>\`, and copy a file into the run's folder before using it. Run nothing from the share: symlinks and `npm` installs fail or crawl on it.
- A tool's own installer writes where it must - `Program Files`, a global `npm` folder. Install nothing the task does not need, and name each install in the close.
- A script committed in a repo before 2026-11-20 that names another folder in the VM keeps it until that repo moves it; the close names the folder it used. A script the run writes follows this rule.
- At the end the `cleanup` rule removes the run's folder and its folder on the share, each by its recorded path, unless it holds work or an output the user asked to keep. It never removes `C:\Claude-MacOs`, a `<repo>` or `shared` folder, or another run's folder.

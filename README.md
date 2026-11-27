<div align="center">

<h1>Novil AI</h1>
<p><strong>100% Offline AI Coding Assistant. No GPU Required.</strong></p>

[![Download Novil](https://img.shields.io/badge/Download-Novil_v1.0.6-06b6d4?style=for-the-badge&logo=windows&logoColor=white&labelColor=1a162b)](https://github.com/juristealle/Novil-AI/releases/latest)

<br />

<p><em>Built for the 99%. No cloud. No subscriptions. Just code.</em></p>

</div>

---

### The Architecture
I built Novil on a standard 16GB RAM laptop with an integrated GPU. My goal was simple: make a local AI as smart as possible, without requiring a $2,000 graphics card. 

Instead of relying on one massive model, Novil uses a custom multi-agent pipeline:
1. **The Reasoner:** Plans the solution.
2. **The Coder:** Writes the code strictly from the plan.
3. **The Reviewer:** Mentally traces the code to catch bugs, missing logic, and scope errors before you ever see it.

This self-correcting architecture allows a small 4B model to punch way above its weight class. We tested Novil Coder with only **2GB of available RAM**, and it didn't just run—it ran fast, and it wrote smart code. 

An 8GB RAM laptop can absolutely run a smart, offline AI coding assistant.

* **No GPU Required:** Built for integrated graphics and standard CPUs.
* **100% Offline:** No API keys, no cloud. Your code never leaves your machine.
* **Self-Correcting:** The AI reviews and traces its own code to catch bugs before you see them.
* **100% Free & Open Source:** The full multi-agent pipeline is now free for everyone. No paywalls, no subscriptions.

### How to Install
1. Click the **Download** button above.
2. Extract the `.zip` folder anywhere on your PC.
3. Double-click `novil.exe`.
4. *Note: On first launch, it will download the base AI model (1.6 GB). After that, you can turn off your Wi-Fi forever.*

*(Windows 10/11 64-bit required. 8GB RAM minimum.)*

### 🛠️ How to Build from Source
If you want to compile Novil yourself, you'll need **Node.js** and **Rust** installed.

1. Clone the repository:
   ```bash
   git clone https://github.com/juristealle/Novil-AI.git
   cd Novil-AI

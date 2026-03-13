# AlgeBench

Interactive 3D math visualizer built on [MathBox](https://github.com/unconed/mathbox) / [Three.js](https://github.com/mrdoob/three.js), with AI chat and narrated lessons — powered by [Gemini](https://deepmind.google/technologies/gemini/). Expressions evaluated via [math.js](https://github.com/josdejong/mathjs).

```
algebench eigenvalues.json
```

![AlgeBench screenshot](docs/orbital-flight-simulation-scene2-root.png)

---

## Demo Videos

**YouTube Channel:** [youtube.com/@AlgeBench](https://www.youtube.com/@AlgeBench)

| Scene | Video |
|-------|-------|
| Rotating Space Habitat Simulation | [Watch](https://www.youtube.com/watch?v=HoZgrAxKKGA) |

---

## Vision

My ultimate goal is to create an agentic system that can genuinely engage in the tangible learning process — fostering that explorative, experimental mindset, willing and courageous enough to ask daring questions freely, supported by an infinitely patient tutor that can meet you exactly where you are and take you wherever you want to go.

---

## Quick Start

**Prerequisites:** Python 3.10+, a [Gemini API key](https://aistudio.google.com/apikey)

```bash
git clone https://github.com/ibenian/algebench
cd algebench
pip install -r requirements.txt
export GEMINI_API_KEY=your_key_here
./algebench
```

Open [http://localhost:8785](http://localhost:8785) in your browser.

To launch directly into a scene:

```bash
./algebench scenes/eigenvalues.json
```

To update to the latest version of [`gemini-live-tools`](https://github.com/ibenian/gemini-live-tools) (which includes new voice characters and the voice picker UI):

```bash
./algebench --update
```

This reinstalls `gemini-live-tools` from GitHub and copies the updated `voice-character-selector.js` into the app. Not ideal, but simple enough for now.

For all available CLI options including TTS settings:

```bash
./algebench --help
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add scenes, voice characters, and more.

## Roadmap

See [docs/feature-ideas.md](docs/feature-ideas.md) for a collection of technical directions and creative ideas under consideration.

## Documentation

- [docs/architecture.md](docs/architecture.md) — System architecture, component overview, data flow
- [docs/sandbox-model.md](docs/sandbox-model.md) — Expression evaluation, trust model, security boundary
- [docs/sandboxing-plan.md](docs/sandboxing-plan.md) — Implementation status and backend sandboxing roadmap
- [docs/feature-ideas.md](docs/feature-ideas.md) — Roadmap ideas and creative directions

---

## Project Structure

```
algebench/
├── algebench          Launcher (run this)
├── server.py          Python server
├── scenes/            Lesson JSON files (contribute here!)
│   ├── eigenvalues.json
│   ├── matrix-transformations.json
│   ├── vector-operations.json
│   └── ...
└── static/
    ├── app.js         3D scene rendering, sliders, camera
    ├── chat.js        AI chat panel, TTS, voice picker
    ├── index.html
    └── style.css
```

---

## License

[MIT](LICENSE)

## Disclaimer

This software is provided for educational and informational purposes only. The authors and contributors make no representations or warranties regarding the accuracy, completeness, or suitability of this software for any particular purpose. Use is entirely at your own risk. The authors shall not be held liable for any direct, indirect, incidental, special, or consequential damages arising from the use of or inability to use this software. Lesson scenes, mathematical visualizations, and AI-generated explanations are all works in progress — they may contain errors or approximations and should not be relied upon as authoritative references.

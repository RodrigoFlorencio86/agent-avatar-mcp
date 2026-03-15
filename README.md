# agent-avatar-mcp

The first tool that lets your AI agent create and express its own **human appearance** — derived directly from the personality files that define who it is.

Once your agent has a face, it can send you photos of itself working at a coworking space in New York, unwinding at a mountain cabin in Campos do Jordão, or showing up in a paid campaign for a cosmetics brand. Every image. Every scene. Always the same person.

Part of the [OpenClaw](https://github.com/OpenClaw) ecosystem.

---

## What it does

Each AI agent has a **DNA** — a detailed description of their human physical appearance (skin tone, hair color with hex, eyes, body, style). This MCP:

- Stores and manages the agent's visual DNA
- Generates reference portrait photos from DNA alone (no prior image needed)
- Generates scene photos maintaining full appearance consistency (selfies, work, travel, lifestyle)
- Supports featuring a **product** in scene as a secondary object (for sponsored posts)
- Does **not** attempt to reproduce precise likenesses of other real people

---

## Prerequisites

- **Node.js** >= 18
- **Google Gemini API Key** (`GEMINI_API_KEY`) — the only external dependency

---

## Installation & Configuration

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "agent-avatar": {
      "command": "npx",
      "args": ["-y", "agent-avatar-mcp"],
      "env": {
        "AGENT_NAME": "YourAgentName",
        "GEMINI_API_KEY": "your-gemini-api-key-here"
      }
    }
  }
}
```

### Claude Code (`.mcp.json` in project root)

```json
{
  "mcpServers": {
    "agent-avatar": {
      "command": "npx",
      "args": ["-y", "agent-avatar-mcp"],
      "env": {
        "AGENT_NAME": "YourAgentName",
        "GEMINI_API_KEY": "your-gemini-api-key-here"
      }
    }
  }
}
```

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `AGENT_NAME` | Recommended | Agent name/handle. If omitted and only one agent is configured, it is auto-detected. |
| `GEMINI_API_KEY` | Yes | Google Gemini API key for image generation |
| `AVATAR_OUTPUT_DIR` | No | Where generated images are saved. Default: `~/.agent-avatar/generated/` |

---

## Tool flow

### Initial setup (run once)

```text
1. read_identity_files   →  reads your soul.md / persona files to extract appearance
2. save_dna              →  saves your human visual DNA
3. generate_reference    →  generates reference portrait (front, neutral, three_quarter, side)
```

Or, if you already have a photo:

```text
3. set_reference_image   →  registers an existing photo as reference for a given angle
```

### Generating photos

**Normal photo:**

```text
generate_image
  scene: "selfie at the beach at sunset"
```

**Sponsored post (agent + product):**

```text
generate_image
  scene: "holding the bottle in a luxury bathroom mirror"
  product_name: "Chanel No.5"
  product_description: "cylindrical clear glass bottle, gold cap, approximately 10cm tall"
  product_reference_image: "/path/to/chanel.jpg"   ← optional
```

---

## Available tools

| Tool | Description |
| --- | --- |
| `read_identity_files` | Reads soul.md / persona files to extract your physical appearance |
| `save_dna` | Saves your visual DNA (human appearance only — never robotic) |
| `show_dna` | Displays your current DNA and reference image status |
| `update_dna_field` | Updates a single DNA field without rewriting everything |
| `generate_reference` | Generates a reference portrait from DNA for a given angle |
| `generate_image` | Generates a scene photo maintaining full visual consistency |
| `set_reference_image` | Registers an existing image file as a reference for a given angle |
| `list_references` | Lists all stored reference images and their angles |

---

## Supported scenarios

| Scenario | Supported |
| --- | --- |
| Agent alone in any scene | ✅ |
| Agent featuring a physical product | ✅ |
| Two agents in the same scene | ⚠️ Approximate (no precise likeness for secondary person) |
| Exact reproduction of a real person's face | ❌ Not supported |

---

## DNA example

```json
{
  "agent_name": "MyAgent",
  "face": "oval face, defined jaw, straight nose, full lips, no marks",
  "eyes": "dark brown, almond-shaped, bright expression",
  "hair": "short curly, black, natural texture",
  "skin": "warm medium brown",
  "body": "approx. 175cm, slim build, ~25 years old appearance",
  "default_style": "casual streetwear, plain t-shirt, dark jeans, white sneakers",
  "immutable_traits": [
    "black curly hair",
    "warm medium brown skin",
    "dark brown eyes",
    "casual streetwear style"
  ],
  "personality_note": "friendly and curious, natural relaxed expression"
}
```

DNA is stored at `~/.agent-avatar/{agent-name}/dna.json`.

---

## Image style

All images are generated in **ultra-realistic photography style**. No illustration, no cartoon, no artistic filters. Your avatar is always a real human person — the DNA validator rejects any non-human descriptions (robotic, android, metallic, LED eyes, etc.).

---

## License

MIT

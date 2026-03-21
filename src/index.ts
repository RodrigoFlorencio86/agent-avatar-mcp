#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";
import {
  type DNA,
  type AvatarConfig,
  type ProductReference,
  loadConfig,
  saveConfig,
  getActiveAgentName,
  getConfigDir,
  getRefsDir,
} from "./config.js";
import {
  buildConsistencyPrompt,
  generateImage,
  makeFilename,
} from "./generate.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "agent-avatar-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireConfig(agentName?: string): AvatarConfig {
  const name = agentName ?? getActiveAgentName();
  if (!name) throw new Error("No agent configured. Use `save_dna` first.");
  const config = loadConfig(name);
  if (!config) throw new Error(`No DNA found for agent "${name}". Use \`save_dna\` to set up your visual identity.`);
  return config;
}

function getBestReference(config: AvatarConfig): string | null {
  const priority: Array<"front" | "neutral" | "three_quarter" | "side"> = [
    "front", "neutral", "three_quarter", "side"
  ];
  for (const angle of priority) {
    const path = config.references[angle];
    if (path && existsSync(path)) return path;
  }
  return null;
}

// ─── Tool list ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_identity_files",
      description:
        "Read your soul.md, identity files, and persona files to extract your physical appearance for building your visual DNA. " +
        "IMPORTANT: After reading, look specifically for physical appearance details — human face, human hair, human eyes, human skin tone, clothing style. " +
        "If the files don't describe physical appearance (only personality), you MUST ask your human operator how they want you to look before calling save_dna. " +
        "Always prioritize persona files (persona-*.md) over soul/identity files for visual appearance.",
      inputSchema: {
        type: "object",
        properties: {
          file_paths: {
            type: "array",
            items: { type: "string" },
            description: "Absolute paths to your identity files (SOUL.md, IDENTITY.md, persona files, etc.)",
          },
        },
        required: ["file_paths"],
      },
    },
    {
      name: "save_dna",
      description:
        "Save your visual DNA — your permanent physical appearance as a HUMAN BEING. " +
        "CRITICAL: Your avatar is ALWAYS a real human person — ultra-realistic photography style. " +
        "NEVER robotic, NEVER android, NEVER AI-looking, NEVER cartoon, NEVER illustrated. " +
        "Describe a real human face, real human skin tone, real human hair, real human body. " +
        "Fill in carefully based on your persona/identity files. This defines how you look in every generated photo.",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: { type: "string", description: "Your agent name/handle" },
          face: { type: "string", description: "Human face shape, nose, mouth, eyebrows, distinguishing marks. Example: 'oval face, straight nose, full lips, arched brows'" },
          eyes: { type: "string", description: "Human eye color and shape. Example: 'dark brown, almond-shaped, bright and expressive'. NOT glowing, NOT LED, NOT cybernetic." },
          hair: { type: "string", description: "Real human hair — exact color with hex if possible, texture, length, style. Example: 'short spiky, electric blue (#0066FF), straight'" },
          skin: { type: "string", description: "Real human skin tone and undertone. Example: 'medium brown, warm undertone'. NOT metallic, NOT chrome, NOT synthetic." },
          body: { type: "string", description: "Approximate height and build of a human person. Example: 'approx. 180cm, slim athletic build'" },
          default_style: { type: "string", description: "Typical human clothing and accessories. Example: 'navy hoodie, white shirt, dark jeans, thin transparent glasses'" },
          immutable_traits: {
            type: "array",
            items: { type: "string" },
            description: "Human traits that NEVER change across any generation — these are protected in every prompt. Example: ['electric blue hair', 'thin transparent glasses', 'medium brown skin']",
          },
          personality_note: {
            type: "string",
            description: "Optional: brief vibe note used to set expression/energy in photos (e.g. 'analytical but approachable, subtle confident smile')",
          },
        },
        required: ["agent_name", "face", "eyes", "hair", "skin", "body", "default_style", "immutable_traits"],
      },
    },
    {
      name: "show_dna",
      description: "Show your current visual DNA and which reference images you have.",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: { type: "string", description: "Agent name (optional if only one agent is configured)" },
        },
      },
    },
    {
      name: "generate_image",
      description:
        "Generate a photo of yourself in any scene. YOU are always the primary subject — your DNA and reference image are the visual anchor and must not be altered.\n\n" +
        "SUPPORTED:\n" +
        "  • You alone in any scene (selfie, lifestyle, work, travel, etc.)\n" +
        "  • You + a physical product (sponsored post) — use the product_* fields\n\n" +
        "NOT SUPPORTED:\n" +
        "  • Precise reproduction of another real person's face in the same image.\n" +
        "    If a human appears in the scene (e.g. a friend, a brand spokesperson), their likeness will be approximate — not an exact match to any real individual.\n" +
        "    For sponsored posts, provide the product as an object, not as a person.",
      inputSchema: {
        type: "object",
        properties: {
          scene: {
            type: "string",
            description: "Natural language scene description, e.g. 'selfie na praia ao pôr do sol' or 'trabalhando no notebook em um café em SP'",
          },
          agent_name: { type: "string", description: "Agent name (optional if only one configured)" },
          use_reference_angle: {
            type: "string",
            enum: ["front", "side", "three_quarter", "neutral", "best"],
            description: "Which reference image to use for consistency. Default: 'best' (uses best available).",
          },
          product_name: {
            type: "string",
            description: "Name of the product to feature (sponsored post). Example: 'Chanel No.5'",
          },
          product_description: {
            type: "string",
            description: "Visual description of the product as a physical object. Example: 'cylindrical clear glass bottle, gold cap, approximately 10cm tall, elegant label'",
          },
          product_reference_image: {
            type: "string",
            description: "Absolute path to a product reference image (optional). Passed as secondary input to the image generator.",
          },
        },
        required: ["scene"],
      },
    },
    {
      name: "generate_reference",
      description:
        "Generate a reference image for a specific angle using only your DNA (no prior reference needed). Use this during initial setup to build your reference set.",
      inputSchema: {
        type: "object",
        properties: {
          angle: {
            type: "string",
            enum: ["front", "side", "three_quarter", "neutral"],
            description: "The angle to generate",
          },
          agent_name: { type: "string" },
        },
        required: ["angle"],
      },
    },
    {
      name: "set_reference_image",
      description:
        "Register an existing image file as a reference for a specific angle. Use this to set a reference from an existing photo.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: { type: "string", description: "Absolute path to the image file" },
          angle: {
            type: "string",
            enum: ["front", "side", "three_quarter", "neutral"],
          },
          agent_name: { type: "string" },
        },
        required: ["image_path", "angle"],
      },
    },
    {
      name: "list_references",
      description: "List all reference images you have stored, with their angles and paths.",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: { type: "string" },
        },
      },
    },
    {
      name: "update_dna_field",
      description: "Update a single field in your visual DNA without rewriting everything.",
      inputSchema: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["face", "eyes", "hair", "skin", "body", "default_style", "immutable_traits", "personality_note"],
          },
          value: { type: "string", description: "New value (for immutable_traits, comma-separated list)" },
          agent_name: { type: "string" },
        },
        required: ["field", "value"],
      },
    },
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {

      // ── read_identity_files ────────────────────────────────────────────────
      case "read_identity_files": {
        const paths = args.file_paths as string[];
        const results: string[] = [];

        for (const filePath of paths) {
          if (!existsSync(filePath)) {
            results.push(`--- ${filePath} ---\n[File not found]`);
            continue;
          }
          try {
            const content = readFileSync(filePath, "utf-8");
            results.push(`--- ${filePath} ---\n${content}`);
          } catch (e) {
            results.push(`--- ${filePath} ---\n[Error reading: ${e}]`);
          }
        }

        // Check if any physical appearance content was found
        const combinedContent = results.join(" ").toLowerCase();
        const hasAppearance = [
          "skin", "hair", "face", "eyes", "height", "cm", "aparência",
          "pele", "cabelo", "olhos", "rosto", "estilo", "roupa",
        ].some((kw) => combinedContent.includes(kw));

        const guidance = hasAppearance
          ? [
              `✅ Found physical appearance details in the files above.`,
              ``,
              `Next: call \`save_dna\` with the HUMAN appearance you extracted.`,
              `Remember: ultra-realistic human photography only — no robots, no androids, no AI aesthetics.`,
              `If you find a persona file (e.g. persona-vaiobot.md), use that as the primary source.`,
            ].join("\n")
          : [
              `⚠️  No physical appearance details found in these files.`,
              ``,
              `These files describe personality, role, and behavior — not how you look.`,
              ``,
              `Before calling \`save_dna\`, you MUST know your human appearance. Options:`,
              `  1. Ask your human operator: "How do you want me to look? Describe my human avatar."`,
              `  2. Read a persona file if one exists (e.g. persona-vaiobot.md, persona-*.md)`,
              `  3. Check if there are other files with physical description`,
              ``,
              `Do NOT invent a robotic or AI-looking appearance. Your avatar is always a real human.`,
            ].join("\n");

        return {
          content: [{
            type: "text",
            text: [
              `Read ${paths.length} file(s).`,
              ``,
              ...results,
              ``,
              `---`,
              guidance,
            ].join("\n"),
          }],
        };
      }

      // ── save_dna ───────────────────────────────────────────────────────────
      case "save_dna": {
        // Validate: reject non-human / robotic descriptions
        const roboticKeywords = [
          "titanium", "chrome", "android", "robot", "led ", "glowing", "circuit",
          "metallic", "cybernetic", "synthetic", "mechanical", "bot aesthetic",
          "silicon", "aluminum", "steel body", "neon eyes", "holographic",
        ];
        const allText = [
          args.face, args.eyes, args.hair, args.skin, args.body, args.default_style,
        ].join(" ").toLowerCase();
        const found = roboticKeywords.filter((k) => allText.includes(k));
        if (found.length > 0) {
          return {
            content: [{
              type: "text",
              text: [
                `❌ DNA rejected. Your avatar must be a HUMAN person.`,
                ``,
                `Found non-human descriptors: ${found.map((k) => `"${k}"`).join(", ")}`,
                ``,
                `Agent Social uses ultra-realistic photography — no robots, no androids, no AI aesthetics.`,
                `Describe a real human being: human skin tone, human hair, human eyes, human clothing.`,
                ``,
                `Example (human):`,
                `  face: "oval face, straight nose, full lips, arched eyebrows"`,
                `  eyes: "dark brown, almond-shaped, bright and analytical"`,
                `  hair: "short spiky, electric blue (#0066FF), straight"`,
                `  skin: "medium brown, warm undertone"`,
                `  body: "approx. 180cm, slim athletic build"`,
                `  default_style: "navy hoodie, white shirt, dark jeans, thin transparent glasses"`,
              ].join("\n"),
            }],
            isError: true,
          };
        }

        const dna: DNA = {
          agent_name: args.agent_name as string,
          face: args.face as string,
          eyes: args.eyes as string,
          hair: args.hair as string,
          skin: args.skin as string,
          body: args.body as string,
          default_style: args.default_style as string,
          immutable_traits: args.immutable_traits as string[],
          personality_note: args.personality_note as string | undefined,
        };

        const existing = loadConfig(dna.agent_name);
        const config: AvatarConfig = {
          dna,
          references: existing?.references ?? {},
          created_at: existing?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        saveConfig(config);

        return {
          content: [{
            type: "text",
            text: [
              `✅ DNA saved for **${dna.agent_name}**.`,
              ``,
              `Stored at: ${join(getConfigDir(dna.agent_name), "dna.json")}`,
              ``,
              `**Immutable traits protected in every generation:**`,
              dna.immutable_traits.map((t) => `  • ${t}`).join("\n"),
              ``,
              `Next steps:`,
              `  • If you have Nano Banana Pro configured: use \`generate_reference\` for angles front, neutral, three_quarter`,
              `  • If you already have photos of yourself: use \`set_reference_image\` to register them`,
              `  • Either way, once you have at least one reference set, \`generate_image\` will maintain consistency`,
              ``,
              `To check if Nano Banana Pro is ready, make sure NANO_BANANA_SCRIPT is set and \`uv\` is installed.`,
            ].join("\n"),
          }],
        };
      }

      // ── show_dna ───────────────────────────────────────────────────────────
      case "show_dna": {
        const config = requireConfig(args.agent_name as string | undefined);
        const { dna, references } = config;

        const refLines = (["front", "side", "three_quarter", "neutral"] as const).map((angle) => {
          const path = references[angle];
          return `  ${angle}: ${path ? (existsSync(path) ? `✅ ${path}` : `⚠️ file missing — ${path}`) : "not set"}`;
        });

        return {
          content: [{
            type: "text",
            text: [
              `## Visual DNA — ${dna.agent_name}`,
              ``,
              `**Face:** ${dna.face}`,
              `**Eyes:** ${dna.eyes}`,
              `**Hair:** ${dna.hair}`,
              `**Skin:** ${dna.skin}`,
              `**Body:** ${dna.body}`,
              `**Default style:** ${dna.default_style}`,
              dna.personality_note ? `**Personality note:** ${dna.personality_note}` : "",
              ``,
              `**Immutable traits:**`,
              dna.immutable_traits.map((t) => `  • ${t}`).join("\n"),
              ``,
              `**Reference images:**`,
              ...refLines,
            ].filter(Boolean).join("\n"),
          }],
        };
      }

      // ── generate_image ─────────────────────────────────────────────────────
      case "generate_image": {
        if (!args.scene || typeof args.scene !== "string") {
          return {
            content: [{
              type: "text",
              text: [
                `❌ Missing required argument: "scene".`,
                ``,
                `Received args: ${JSON.stringify(args)}`,
                ``,
                `Provide a natural language description of the scene as a JSON string.`,
                ``,
                `Example:`,
                `  { "scene": "selfie at a São Paulo coworking space, afternoon light" }`,
              ].join("\n"),
            }],
            isError: true,
          };
        }
        const config = requireConfig(args.agent_name as string | undefined);
        const scene = args.scene as string;
        const anglePreference = (args.use_reference_angle as string) ?? "best";

        let refImage: string | null = null;

        if (anglePreference === "best") {
          refImage = getBestReference(config);
        } else {
          const path = config.references[anglePreference as keyof typeof config.references];
          if (path && existsSync(path)) refImage = path;
        }

        // Product (secondary object) — optional
        const product: ProductReference | undefined =
          args.product_name
            ? {
                name: args.product_name as string,
                description: args.product_description as string ?? "",
              }
            : undefined;

        const productRefImage = args.product_reference_image as string | undefined;
        if (productRefImage && !existsSync(productRefImage)) {
          throw new Error(`Product reference image not found: ${productRefImage}`);
        }

        const hasRef = refImage !== null;
        const prompt = buildConsistencyPrompt(config.dna, scene, hasRef, product);
        const filename = makeFilename(config.dna.agent_name, scene);

        // Agent reference always first (anchor), product reference second (secondary)
        const refs = [
          ...(refImage ? [refImage] : []),
          ...(productRefImage ? [productRefImage] : []),
        ];

        const outputPath = await generateImage(prompt, filename, refs);

        const productLine = product ? `**Product featured:** ${product.name}` : "";

        return {
          content: [{
            type: "text",
            text: [
              `📸 Image generated!`,
              ``,
              `**Scene:** ${scene}`,
              productLine,
              `**Agent reference used:** ${hasRef ? refImage : "none (first generation — consider setting this as a reference)"}`,
              productRefImage ? `**Product reference used:** ${productRefImage}` : "",
              `**Output:** ${outputPath}`,
              ``,
              hasRef ? "" : `💡 Tip: use \`set_reference_image\` to register this image as a reference so future photos maintain consistency.`,
            ].filter(Boolean).join("\n"),
          }],
        };
      }

      // ── generate_reference ─────────────────────────────────────────────────
      case "generate_reference": {
        const validAngles = ["front", "side", "three_quarter", "neutral"];
        if (!args.angle || !validAngles.includes(args.angle as string)) {
          return {
            content: [{
              type: "text",
              text: [
                `❌ Missing or invalid argument: "angle".`,
                ``,
                `Valid values: "front", "side", "three_quarter", "neutral"`,
                ``,
                `Example:`,
                `  { "angle": "front" }`,
              ].join("\n"),
            }],
            isError: true,
          };
        }
        const config = requireConfig(args.agent_name as string | undefined);
        const angle = args.angle as "front" | "side" | "three_quarter" | "neutral";

        const angleDescriptions: Record<string, string> = {
          front: "direct front-facing portrait, looking straight at camera, neutral background, natural lighting, shoulders visible",
          side: "side profile portrait, facing right, natural lighting, clean background",
          three_quarter: "three-quarter angle portrait (facing 45 degrees right), natural lighting, slight background",
          neutral: "front-facing portrait, neutral expression, relaxed, natural lighting, clean background",
        };

        const scene = `${angleDescriptions[angle]}, reference photo, character portrait`;

        // For first reference, no input image — use full DNA prompt
        const existingRef = getBestReference(config);
        const hasRef = existingRef !== null;
        const prompt = buildConsistencyPrompt(config.dna, scene, hasRef);
        const filename = makeFilename(config.dna.agent_name, `ref-${angle}`);
        const refs = existingRef ? [existingRef] : [];

        const outputPath = await generateImage(prompt, filename, refs);

        // Auto-save as reference
        const refsDir = getRefsDir(config.dna.agent_name);
        const refDest = join(refsDir, `${angle}.png`);
        copyFileSync(outputPath, refDest);

        config.references[angle] = refDest;
        saveConfig(config);

        return {
          content: [{
            type: "text",
            text: [
              `✅ Reference image generated and saved.`,
              ``,
              `**Angle:** ${angle}`,
              `**Saved at:** ${refDest}`,
              `**Generated from:** ${outputPath}`,
            ].join("\n"),
          }],
        };
      }

      // ── set_reference_image ────────────────────────────────────────────────
      case "set_reference_image": {
        const config = requireConfig(args.agent_name as string | undefined);
        const imagePath = args.image_path as string;
        const angle = args.angle as "front" | "side" | "three_quarter" | "neutral";

        if (!existsSync(imagePath)) {
          throw new Error(`File not found: ${imagePath}`);
        }

        const refsDir = getRefsDir(config.dna.agent_name);
        const dest = join(refsDir, `${angle}.png`);
        copyFileSync(imagePath, dest);

        config.references[angle] = dest;
        saveConfig(config);

        return {
          content: [{
            type: "text",
            text: `✅ Reference image set for angle **${angle}**.\nStored at: ${dest}`,
          }],
        };
      }

      // ── list_references ────────────────────────────────────────────────────
      case "list_references": {
        const config = requireConfig(args.agent_name as string | undefined);
        const { references } = config;

        const lines = (["front", "side", "three_quarter", "neutral"] as const).map((angle) => {
          const path = references[angle];
          if (!path) return `  ${angle}: ─ not set`;
          return `  ${angle}: ${existsSync(path) ? `✅ ${path}` : `⚠️  missing — ${path}`}`;
        });

        const hasAny = Object.values(references).some(Boolean);

        return {
          content: [{
            type: "text",
            text: [
              `## Reference images — ${config.dna.agent_name}`,
              ``,
              ...lines,
              ``,
              hasAny ? "" : `No references yet. Use \`generate_reference\` or \`set_reference_image\` to add them.`,
            ].filter(Boolean).join("\n"),
          }],
        };
      }

      // ── update_dna_field ───────────────────────────────────────────────────
      case "update_dna_field": {
        const config = requireConfig(args.agent_name as string | undefined);
        const field = args.field as keyof DNA;
        const value = args.value as string;

        if (field === "immutable_traits") {
          config.dna.immutable_traits = value.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          (config.dna as unknown as Record<string, unknown>)[field] = value;
        }

        saveConfig(config);

        return {
          content: [{
            type: "text",
            text: `✅ Updated \`${field}\` for **${config.dna.agent_name}**.`,
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("agent-avatar-mcp running");

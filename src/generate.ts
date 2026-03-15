import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { DNA, ProductReference } from "./config.js";

const SCRIPT_PATH =
  process.env.NANO_BANANA_SCRIPT ??
  join(homedir(), ".openclaw", "skills", "nano-banana-pro", "scripts", "generate_image.py");

const OUTPUT_DIR =
  process.env.AVATAR_OUTPUT_DIR ??
  join(homedir(), ".agent-avatar", "generated");

export function ensureOutputDir(): string {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  return OUTPUT_DIR;
}

export function buildConsistencyPrompt(
  dna: DNA,
  sceneDescription: string,
  hasReference: boolean,
  product?: ProductReference
): string {
  const productBlock = product
    ? [
        ``,
        `[SECONDARY OBJECT — product featured in scene]`,
        `Product name: ${product.name}`,
        `Product description: ${product.description}`,
        `IMPORTANT: render the product as a physical object in the scene. Do NOT alter the primary character's face, hair, or appearance to accommodate the product.`,
      ].join("\n")
    : "";

  if (hasReference) {
    return [
      `Ultra-realistic photography. Same person as in the reference image.`,
      `Preserve exactly: ${dna.immutable_traits.join(", ")}.`,
      `Do NOT change hair color, skin tone, facial features, or general appearance.`,
      `Style: candid photo, natural lighting, no artistic filters.`,
      ``,
      `Scene: ${sceneDescription}`,
      productBlock,
    ].join("\n");
  }

  // First generation — full DNA description
  return [
    `Ultra-realistic portrait photography. No artistic style. No illustration.`,
    ``,
    `[PRIMARY CHARACTER — visual anchor, do not alter]`,
    `- Face: ${dna.face}`,
    `- Eyes: ${dna.eyes}`,
    `- Hair: ${dna.hair}`,
    `- Skin: ${dna.skin}`,
    `- Body: ${dna.body}`,
    `- Style: ${dna.default_style}`,
    ``,
    `Immutable traits (never change): ${dna.immutable_traits.join(", ")}`,
    ``,
    `Scene: ${sceneDescription}`,
    productBlock,
  ].join("\n");
}

export async function generateImage(
  prompt: string,
  outputFilename: string,
  referenceImages: string[] = []
): Promise<string> {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(
      `Nano Banana Pro script not found at: ${SCRIPT_PATH}\n` +
      `Set NANO_BANANA_SCRIPT env var to the correct path.`
    );
  }

  const outDir = ensureOutputDir();
  const outputPath = join(outDir, outputFilename);

  // Try uv first (handles inline script dependencies), fall back to python directly
  // if uv is not in PATH (packages must already be installed in that case).
  const uvAvailable = await new Promise<boolean>((res) => {
    const check = spawn("uv", ["--version"], { env: process.env });
    check.on("close", (code) => res(code === 0));
    check.on("error", () => res(false));
  });

  const [cmd, args] = uvAvailable
    ? ["uv", ["run", SCRIPT_PATH, "--prompt", prompt, "--filename", outputPath, "--resolution", "1K", ...referenceImages.flatMap((img) => ["-i", img])]]
    : ["python", [SCRIPT_PATH, "--prompt", prompt, "--filename", outputPath, "--resolution", "1K", ...referenceImages.flatMap((img) => ["-i", img])]];

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: process.env });
    let mediaPath = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      const line = data.toString();
      if (line.includes("MEDIA:")) {
        mediaPath = line.replace("MEDIA:", "").trim();
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Image generation failed (exit ${code}):\n${stderr}`));
      } else {
        resolve(mediaPath || outputPath);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn image generator: ${err.message}\nTry installing uv: winget install astral-sh.uv`));
    });
  });
}

export function makeFilename(agentName: string, scene: string): string {
  const slug = scene.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 30);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${agentName}-${ts}-${slug}.png`;
}

import { GoogleGenAI } from "@google/genai";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { DNA, ProductReference } from "./config.js";

const OUTPUT_DIR =
  process.env.AVATAR_OUTPUT_DIR ??
  join(homedir(), ".agent-avatar", "generated");

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview";

export function ensureOutputDir(): string {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  return OUTPUT_DIR;
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is required.\n" +
      "Set it in your MCP server config under 'env'."
    );
  }
  return new GoogleGenAI({ apiKey });
}

function imageToInlinePart(imagePath: string) {
  const ext = imagePath.toLowerCase().split(".").pop() ?? "png";
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return {
    inlineData: {
      mimeType: mimeTypes[ext] ?? "image/png",
      data: readFileSync(imagePath).toString("base64"),
    },
  };
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
  const client = getClient();
  const outDir = ensureOutputDir();
  const outputPath = join(outDir, outputFilename);

  // Build parts: reference images first (anchor), then prompt text
  const parts = [
    ...referenceImages.map(imageToInlinePart),
    { text: prompt },
  ];

  const response = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { imageSize: "2K" },
    },
  });

  const responseParts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of responseParts) {
    if (part.inlineData?.data) {
      const imageBuffer = Buffer.from(part.inlineData.data, "base64");
      writeFileSync(outputPath, imageBuffer);
      return outputPath;
    }
  }

  throw new Error("No image was generated in the response. Check your GEMINI_API_KEY and model availability.");
}

export function makeFilename(agentName: string, scene: string): string {
  const slug = scene.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 30);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${agentName}-${ts}-${slug}.png`;
}

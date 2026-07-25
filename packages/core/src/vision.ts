import vision from '@google-cloud/vision';

let client: InstanceType<typeof vision.ImageAnnotatorClient> | undefined;

/**
 * Fallback OCR via Cloud Vision (documentTextDetection), utilisé quand Gemini
 * répond RECITATION / blocage / vide. Auth par service account (ADC), sans clé.
 */
export async function visionOcrImage(image: Buffer): Promise<string> {
  client ??= new vision.ImageAnnotatorClient();
  const [res] = await client.documentTextDetection({
    image: { content: image },
    imageContext: { languageHints: ['ar'] },
  });
  const text = res.fullTextAnnotation?.text?.trim() ?? '';
  if (text === '') throw new Error('Cloud Vision : aucun texte détecté');
  return text;
}

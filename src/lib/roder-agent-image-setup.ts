export async function configureImageGenerationKey(
  apiKey: string,
  configure: (params: { apiKey: string }) => Promise<{ configured: boolean }>,
): Promise<{ configured: boolean; error: string | null }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { configured: false, error: "Enter an OpenAI API key." };
  try {
    const result = await configure({ apiKey: trimmed });
    return result.configured
      ? { configured: true, error: null }
      : { configured: false, error: "The image key was not configured. Try again." };
  } catch {
    return { configured: false, error: "Couldn’t save the image key. Try again." };
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { generateStream } from '@/lib/ai';
import { requireRole, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // allow up to 60s for streaming LLM responses

const MAX_PROMPT_LENGTH = 500;

export async function POST(req: NextRequest) {
  // -- Auth ---
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;

  // -- Parse & validate body ---
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const trimmedPrompt: string = body?.prompt?.trim() ?? '';
  if (!trimmedPrompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }
  if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const promptText = `Generate a form or course schema for the following use case: "${trimmedPrompt}". Make sure to include all necessary fields, a catchy title, and a brief description. If the user asks for a course, set isCourse to true and populate the questions array with multiple-choice questions.`;

  const responseSchema = {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Form or Course title' },
          description: { type: 'string', description: 'Form or Course description' },
          isCourse: { type: 'boolean', description: 'True if the user requested a course' },
          eventDetails: {
            type: 'object',
            description: 'If the form is for an event (live or online), provide these details. Omit if not an event.',
            properties: {
              isEvent: { type: 'boolean', description: 'True if this form is for an event' },
              date: { type: 'string', description: "Date of the event (e.g., 'October 15, 2026')" },
              time: { type: 'string', description: "Time of the event (e.g., '10:00 AM')" },
              location: { type: 'string', description: 'Physical location or online link' },
              timezone: { type: 'string', description: "Timezone of the event (e.g., 'PST', 'UTC')" },
            },
            required: ['isEvent'],
          },
          fields: {
            type: 'array',
            description: 'Fields for a regular form. Provide this if isCourse is false.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique random string ID' },
                name: { type: 'string', description: 'camelCase identifier' },
                label: { type: 'string', description: 'Human readable label' },
                type: { type: 'string', description: 'Must be one of: text, email, textarea, number, select' },
                placeholder: { type: 'string' },
                options: { type: 'array', items: { type: 'string' }, description: 'Only provide if type is select' },
              },
              required: ['id', 'name', 'label', 'type'],
            },
          },
          questions: {
            type: 'array',
            description: 'Questions for a quiz. Provide this if isCourse is true.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique random string ID' },
                question: { type: 'string', description: 'The quiz question text' },
                options: { type: 'array', items: { type: 'string' }, description: 'Array of possible answers (usually 4)' },
                correctAnswer: { type: 'string', description: 'The correct answer (must match one of the options exactly)' },
                explanation: { type: 'string', description: 'Optional explanation of why the answer is correct' },
              },
              required: ['id', 'question', 'options', 'correctAnswer'],
            },
          },
        },
        required: ['title', 'description'],
  };

  try {
    const stream = await generateStream(promptText, responseSchema, { feature: 'generate', usageContext: { operation: 'generate' } });
    return new Response(stream, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error: any) {
    console.error('[generate] stream error:', error);
    return NextResponse.json({ error: 'Generation failed. Please try again.' }, { status: 500 });
  }
}

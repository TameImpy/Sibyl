import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const filePath = join(process.cwd(), '..', '..', 'data', 'taxonomy', 'taxonomy-v1.json');
    const raw = readFileSync(filePath, 'utf-8');
    const taxonomy = JSON.parse(raw) as unknown;
    return NextResponse.json(taxonomy);
  } catch {
    return NextResponse.json({ error: 'Failed to load taxonomy' }, { status: 500 });
  }
}

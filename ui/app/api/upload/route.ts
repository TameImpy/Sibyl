import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { s3Client, S3_UPLOAD_BUCKET } from '@/lib/aws';
import { randomUUID } from 'crypto';

const Schema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  fileSize: z.number().positive().max(2 * 1024 * 1024 * 1024), // 2 GB cap (Gemini File API limit)
});

/** Strip path separators and keep only safe characters. */
function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { fileName, contentType, fileSize } = parsed.data;

    if (!S3_UPLOAD_BUCKET) {
      return NextResponse.json({ error: 'S3_UPLOAD_BUCKET is not configured' }, { status: 500 });
    }

    const safeName = sanitizeFileName(fileName);
    const s3Key = `uploads/${Date.now()}-${randomUUID()}/${safeName}`;
    const s3Uri = `s3://${S3_UPLOAD_BUCKET}/${s3Key}`;

    const command = new PutObjectCommand({
      Bucket: S3_UPLOAD_BUCKET,
      Key: s3Key,
      ContentType: contentType,
      ContentLength: fileSize,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour for large uploads

    return NextResponse.json({ uploadUrl, s3Key, s3Uri });
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

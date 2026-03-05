import { NextRequest, NextResponse } from 'next/server';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TAGS_TABLE_NAME } from '@/lib/aws';

export async function POST(
  req: NextRequest,
  { params }: { params: { contentId: string } },
) {
  const { contentId } = params;
  const body = await req.json().catch(() => ({}));
  const contentType = body?.content_type as string | undefined;

  if (!contentType) {
    return NextResponse.json({ error: 'content_type required' }, { status: 400 });
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TAGS_TABLE_NAME,
        Key: { content_id: contentId, content_type: contentType },
        UpdateExpression: 'SET #s = :complete, needs_review = :false',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':complete': 'complete',
          ':false': 'false',
        },
        ConditionExpression: 'attribute_exists(content_id)',
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    console.error('Approve error', err);
    return NextResponse.json({ error: 'Failed to approve item' }, { status: 502 });
  }
}

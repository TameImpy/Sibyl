import { NextRequest, NextResponse } from 'next/server';
import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TAGS_TABLE_NAME } from '@/lib/aws';
import { findRelated, TaggedItem } from '@/lib/relatedness';

async function fetchAllComplete(): Promise<TaggedItem[]> {
  const items: TaggedItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TAGS_TABLE_NAME,
        IndexName: 'status-index',
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'complete' },
        ScanIndexForward: false,
        Limit: 500,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as TaggedItem[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { contentId: string } },
) {
  const { contentId } = params;
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '6'), 20);
  const contentType = req.nextUrl.searchParams.get('contentType') ?? undefined;

  try {
    // If contentType is provided, use GetCommand; otherwise scan all complete items to find the target
    let target: TaggedItem | undefined;

    if (contentType) {
      const result = await docClient.send(
        new GetCommand({
          TableName: TAGS_TABLE_NAME,
          Key: { content_id: contentId, content_type: contentType },
        }),
      );
      target = result.Item as TaggedItem | undefined;
    }

    // Fetch all complete items (used both to find target if needed, and as candidates)
    const allItems = await fetchAllComplete();

    if (!target) {
      target = allItems.find((i) => i.content_id === contentId);
    }

    if (!target) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    const related = findRelated(target, allItems, limit);
    return NextResponse.json({ related });
  } catch (err) {
    console.error('Related content error', err);
    return NextResponse.json({ error: 'Failed to compute related content' }, { status: 502 });
  }
}

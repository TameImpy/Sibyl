import { NextRequest, NextResponse } from 'next/server';
import { QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { docClient, TAGS_TABLE_NAME } from '@/lib/aws';

interface DynamoItem {
  content_id: string;
  content_type: string;
  title?: string;
  status?: string;
  tags?: Array<{ tag: string; confidence: number }>;
  created_at?: string;
}

async function fetchByStatus(cursor?: string): Promise<DynamoItem[]> {
  const params: QueryCommandInput = {
    TableName: TAGS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': 'complete' },
    ScanIndexForward: false,
    Limit: 500, // over-fetch for in-memory filtering
  };
  if (cursor) {
    try {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    } catch {
      // ignore malformed cursor
    }
  }
  const result = await docClient.send(new QueryCommand(params));
  return (result.Items ?? []) as DynamoItem[];
}

async function fetchByContentType(contentType: string): Promise<DynamoItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TAGS_TABLE_NAME,
      IndexName: 'content-type-index',
      KeyConditionExpression: 'content_type = :ct',
      ExpressionAttributeValues: { ':ct': contentType },
      ScanIndexForward: false,
      Limit: 500,
    }),
  );
  return (result.Items ?? []) as DynamoItem[];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tagsParam = sp.get('tags');
  const typeParam = sp.get('type');
  const limit = Math.min(Number(sp.get('limit') ?? '50'), 200);
  const cursor = sp.get('cursor') ?? undefined;

  const filterTags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];

  try {
    let items: DynamoItem[];

    if (typeParam) {
      items = await fetchByContentType(typeParam);
      // content-type-index may return all statuses; filter to complete only
      items = items.filter((i) => i.status === 'complete');
    } else {
      items = await fetchByStatus(cursor);
    }

    // In-memory tag AND filter
    if (filterTags.length > 0) {
      items = items.filter((item) => {
        const itemTags = new Set((item.tags ?? []).map((t) => t.tag));
        return filterTags.every((ft) => itemTags.has(ft));
      });
    }

    const total = items.length;
    const page = items.slice(0, limit);

    const response = page.map((item) => ({
      content_id: item.content_id,
      content_type: item.content_type,
      title: item.title ?? item.content_id,
      tags: (item.tags ?? []).map((t) => t.tag),
      tag_count: (item.tags ?? []).length,
      created_at: item.created_at,
    }));

    return NextResponse.json({ items: response, total });
  } catch (err) {
    console.error('Explorer query error', err);
    return NextResponse.json({ error: 'Failed to fetch content' }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TAGS_TABLE_NAME } from '@/lib/aws';

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '20'), 100);

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TAGS_TABLE_NAME,
        IndexName: 'needs-review-index',
        KeyConditionExpression: 'needs_review = :nr',
        ExpressionAttributeValues: { ':nr': 'true' },
        ScanIndexForward: false, // descending by created_at
        Limit: limit,
      }),
    );

    return NextResponse.json({ items: result.Items ?? [], count: result.Count ?? 0 });
  } catch (err) {
    console.error('DynamoDB query error', err);
    return NextResponse.json({ error: 'Failed to fetch review queue' }, { status: 502 });
  }
}

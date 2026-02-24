import { NextRequest, NextResponse } from 'next/server';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TAGS_TABLE_NAME } from '@/lib/aws';

export async function GET(req: NextRequest, { params }: { params: { contentId: string } }) {
  const { contentId } = params;
  const contentType = req.nextUrl.searchParams.get('contentType');

  if (!contentType) {
    return NextResponse.json({ error: 'contentType query param required' }, { status: 400 });
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TAGS_TABLE_NAME,
        Key: {
          content_id: contentId,
          content_type: contentType,
        },
      }),
    );

    if (!result.Item) {
      return NextResponse.json({ status: 'pending' });
    }

    return NextResponse.json(result.Item);
  } catch (err) {
    console.error('DynamoDB get error', err);
    return NextResponse.json({ error: 'Failed to fetch result' }, { status: 502 });
  }
}

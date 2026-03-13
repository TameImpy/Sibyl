import { NextRequest, NextResponse } from 'next/server';
import { QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { docClient, TAGS_TABLE_NAME } from '@/lib/aws';
import { getAzureSqlPool } from '@/lib/azure-sql';

interface DynamoItem {
  content_id: string;
  content_type: string;
  content_url?: string;
  status?: string;
  tags?: Array<{ tag: string; confidence: number }>;
}

interface RevenueRow {
  url: string;
  daily_ad_revenue: number;
  page_views: number;
  users: number;
}

interface TagMetrics {
  tag: string;
  item_count: number;
  matched_revenue_count: number;
  total_daily_revenue: number;
  total_page_views: number;
  total_users: number;
}

async function fetchAllCompleteItems(): Promise<DynamoItem[]> {
  const items: DynamoItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const params: QueryCommandInput = {
      TableName: TAGS_TABLE_NAME,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'complete' },
      ScanIndexForward: false,
      Limit: 500,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    };
    const result = await docClient.send(new QueryCommand(params));
    items.push(...((result.Items ?? []) as DynamoItem[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

async function fetchRevenueRows(pool: NonNullable<Awaited<ReturnType<typeof getAzureSqlPool>>>): Promise<RevenueRow[]> {
  const result = await pool.request().query(
    'SELECT url, daily_ad_revenue, page_views, users FROM content_revenue'
  );
  return result.recordset as RevenueRow[];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tagsParam = sp.get('tags');
  const typeParam = sp.get('type');
  const filterTags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];

  try {
    // Step 1: Fetch all complete DynamoDB items
    let items = await fetchAllCompleteItems();

    // Apply optional type filter
    if (typeParam) {
      items = items.filter((i) => i.content_type === typeParam);
    }

    // Apply optional tag AND filter
    if (filterTags.length > 0) {
      items = items.filter((item) => {
        const itemTags = new Set((item.tags ?? []).map((t) => t.tag));
        return filterTags.every((ft) => itemTags.has(ft));
      });
    }

    const totalItems = items.length;

    // Step 2: Try Azure SQL connection
    const pool = await getAzureSqlPool();
    const azureSqlConnected = pool !== null;

    let revenueMap = new Map<string, RevenueRow>();
    if (pool) {
      const rows = await fetchRevenueRows(pool);
      revenueMap = new Map(rows.map((r) => [r.url, r]));
    }

    // Step 3: Aggregate per-tag metrics via in-memory join
    const tagMetrics = new Map<string, TagMetrics>();

    let matchedItemCount = 0;

    for (const item of items) {
      const revenue = item.content_url ? revenueMap.get(item.content_url) : undefined;
      if (revenue) matchedItemCount++;

      for (const tagObj of item.tags ?? []) {
        const t = tagObj.tag;
        if (!tagMetrics.has(t)) {
          tagMetrics.set(t, {
            tag: t,
            item_count: 0,
            matched_revenue_count: 0,
            total_daily_revenue: 0,
            total_page_views: 0,
            total_users: 0,
          });
        }
        const m = tagMetrics.get(t)!;
        m.item_count++;
        if (revenue) {
          m.matched_revenue_count++;
          m.total_daily_revenue += Number(revenue.daily_ad_revenue);
          m.total_page_views += revenue.page_views;
          m.total_users += revenue.users;
        }
      }
    }

    // Step 4: Compute averages and sort
    const tags = Array.from(tagMetrics.values())
      .map((m) => {
        const n = m.matched_revenue_count;
        const avg_daily_revenue = n > 0 ? Math.round((m.total_daily_revenue / n) * 100) / 100 : 0;
        const avg_page_views = n > 0 ? Math.round(m.total_page_views / n) : 0;
        const avg_users = n > 0 ? Math.round(m.total_users / n) : 0;
        const revenue_per_user =
          avg_users > 0 ? Math.round((avg_daily_revenue / avg_users) * 1_000) / 1_000 : 0;

        return {
          tag: m.tag,
          item_count: m.item_count,
          matched_revenue_count: m.matched_revenue_count,
          avg_daily_revenue,
          avg_page_views,
          avg_users,
          revenue_per_user,
        };
      })
      .sort((a, b) => b.avg_daily_revenue - a.avg_daily_revenue);

    const coveragePct =
      totalItems > 0 ? Math.round((matchedItemCount / totalItems) * 100) : 0;

    return NextResponse.json({
      tags,
      total_items: totalItems,
      coverage_pct: coveragePct,
      azure_sql_connected: azureSqlConnected,
    });
  } catch (err) {
    console.error('Analytics query error', err);
    return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 502 });
  }
}

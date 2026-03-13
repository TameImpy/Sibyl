import sql from 'mssql';

const config: sql.config = {
  server: process.env.AZURE_SQL_SERVER ?? '',
  database: process.env.AZURE_SQL_DATABASE ?? '',
  user: process.env.AZURE_SQL_USER ?? '',
  password: process.env.AZURE_SQL_PASSWORD ?? '',
  port: Number(process.env.AZURE_SQL_PORT ?? '1433'),
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  connectionTimeout: 10_000,
  requestTimeout: 15_000,
};

let pool: sql.ConnectionPool | null = null;
let poolPromise: Promise<sql.ConnectionPool | null> | null = null;

export async function getAzureSqlPool(): Promise<sql.ConnectionPool | null> {
  if (pool?.connected) return pool;

  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    try {
      pool = await new sql.ConnectionPool(config).connect();
      return pool;
    } catch (err) {
      console.error('[azure-sql] Connection failed:', err);
      pool = null;
      poolPromise = null;
      return null;
    }
  })();

  return poolPromise;
}

export type { sql };

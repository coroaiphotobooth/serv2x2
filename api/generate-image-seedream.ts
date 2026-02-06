
export default async function handler(req: any, res: any) {
  // Redirect to new unified endpoint
  return res.status(410).json({ 
    error: 'This endpoint is deprecated. Use /api/image/generate with valid model.' 
  });
}

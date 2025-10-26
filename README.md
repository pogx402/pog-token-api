# POG Token x402 API

Backend API for minting POG tokens via x402 Protocol with **Payment Verification** - No frontend needed!

## 🎯 Features

- ✅ x402 Protocol compliant
- ✅ **USDC payment verification** on Base Mainnet
- ✅ Automatically mint 10,000 POG tokens after payment verification
- ✅ No frontend required - works with x402scan.com or x402-compatible wallets
- ✅ Double-mint prevention (transaction hash tracking)
- ✅ Blockchain-based payment verification

## 📋 API Endpoints

### GET /

API information and usage instructions

### GET /mint

Mint POG tokens (x402 endpoint)

- **Price:** 1 USDC
- **Reward:** 10,000 POG tokens
- **Network:** Base Mainnet
- **Payment Verification:** ✅ Enabled

### GET /stats

Minting statistics and contract information

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` file:
```bash
PRIVATE_KEY=your_wallet_private_key
POG_CONTRACT_ADDRESS=your_pog_token_address
PAYMENT_ADDRESS=your_payment_address  # Optional - defaults to wallet address
PORT=3000
```

### 3. Run Locally

```bash
npm start
```

Visit: `http://localhost:3000`

## 🌐 Usage

### Via x402scan.com (Recommended)

1. Go to https://x402scan.com
2. Search for "POG" or paste your API URL
3. Click "Fetch" to see payment options
4. Authorize payment of 1 USDC
5. Receive 10,000 POG tokens automatically

### Via x402 Compatible Wallet

1. Send GET request to `/mint`
2. Wallet displays payment request with x402 schema
3. Pay 1 USDC to payment address
4. Get transaction hash
5. Call `/mint` with `X-Payment-Tx` header
6. Receive 10,000 POG tokens

### Via API Directly

```bash
# Step 1: Get 402 response with payment requirements
curl https://your-api.com/mint

# Step 2: Send 1 USDC to the payment address shown in response
# Use any wallet (MetaMask, etc.) on Base Mainnet

# Step 3: Get the transaction hash from blockchain

# Step 4: Call mint endpoint with transaction hash
curl -H "X-Payment-Tx: YOUR_TX_HASH" https://your-api.com/mint
```

## 🔧 Configuration

### Environment Variables

- `PRIVATE_KEY`: Your wallet private key (must have POG tokens to mint)
- `POG_CONTRACT_ADDRESS`: POG token contract address on Base Mainnet
- `PAYMENT_ADDRESS`: (Optional) Address where users send USDC. Defaults to wallet address from PRIVATE_KEY
- `PORT`: Server port (default: 3000)

### Contract Addresses

- **USDC (Base Mainnet):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **POG Token:** Set in `.env`
- **Payment Address:** Configured in `.env` or derived from `PRIVATE_KEY`

## 📦 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import to Vercel
3. Add environment variables:
   - `PRIVATE_KEY`
   - `POG_CONTRACT_ADDRESS`
   - `PAYMENT_ADDRESS` (optional)
4. Deploy

### Railway / Render

1. Connect GitHub repo
2. Add environment variables
3. Deploy

## 🔐 Security

- ✅ Private key stored in environment variables only
- ✅ **Payment verification via blockchain transactions**
- ✅ Transaction hash validation
- ✅ Double-mint prevention (processed payments tracking)
- ✅ No sensitive data in code
- ✅ `.env` file excluded from git
- ✅ CORS enabled for x402 compatibility

## 📝 x402 Schema (402 Response)

When calling `/mint` without payment proof:

```json
{
  "x402Version": 1,
  "error": "X-Payment-Tx header is required",
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "1000000",
    "resource": "https://your-api.com/mint",
    "description": "Mint 10,000 $POG tokens - Pay 1 USDC on Base",
    "mimeType": "application/json",
    "payTo": "0xYOUR_PAYMENT_ADDRESS",
    "maxTimeoutSeconds": 300,
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "extra": {
      "name": "POG Token",
      "version": "2",
      "requiredAmount": "1",
      "requiredDecimals": 6
    }
  }]
}
```

## 🔄 Payment Flow

1. **User initiates mint request** → `GET /mint`
2. **API returns 402 with payment schema** ← x402 response
3. **User sends 1 USDC** to payment address on Base Mainnet
4. **User gets transaction hash** from blockchain explorer
5. **User calls `/mint` with X-Payment-Tx header** → `GET /mint -H "X-Payment-Tx: 0x..."`
6. **API verifies payment on blockchain**:
   - Checks if transaction exists
   - Verifies USDC transfer to payment address
   - Confirms amount is at least 1 USDC
7. **API mints POG tokens** to payer address
8. **User receives 10,000 POG tokens** ✅

## 🆘 Troubleshooting

### "Transaction not found"
- Wait for transaction confirmation on blockchain (1-2 minutes)
- Verify transaction hash is correct
- Check on Base Mainnet explorer: https://basescan.org

### "Invalid payment amount"
- Must send exactly or more than 1 USDC
- Verify using USDC on Base Mainnet
- Check USDC contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

### "Payment already processed"
- This transaction has already been used to mint tokens
- Use a different transaction hash
- Each payment can only mint once

### "No USDC transfer to payment address found"
- Transaction must include USDC transfer to payment address
- Verify payment address in API response
- Check transaction on Base Mainnet explorer

### "Insufficient balance"
- Wallet needs ETH for gas fees
- Wallet needs enough POG tokens to mint
- Check wallet balance: `GET /stats`

### "Payer address does not match transaction"
- The payer address must match the transaction sender
- Include correct payer address in request

## 📊 Next Steps

1. Deploy API to production (Vercel/Railway/Render)
2. Register on x402scan.com (https://x402scan.com/add_resources=true)
3. Share API URL with community
4. Monitor transactions via `/stats` endpoint
5. Track minting statistics

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

## 📞 Support

For issues or questions, please open an issue on GitHub.

---

**Version:** 2.4.0-payment-enforced  
**Last Updated:** October 2025  
**Status:** ✅ Payment Verification Enabled


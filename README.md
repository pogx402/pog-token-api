# POG Token x402 API

Backend API for minting POG tokens via x402 Protocol - **No frontend needed!**

## 🎯 Features

- ✅ x402 Protocol compliant
- ✅ Accept USDC payments on Base Mainnet
- ✅ Automatically mint 10,000 POG tokens after payment
- ✅ No frontend required - works with x402scan.com or x402-compatible wallets

## 📋 API Endpoints

### GET /

API information and usage instructions

### GET /mint

Mint POG tokens (x402 endpoint)

- **Price:** 1 USDC
- **Reward:** 10,000 POG tokens
- **Network:** Base Mainnet

### GET /stats

Minting statistics

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
PORT=3000
```

### 3. Run Locally

```bash
npm start
```

Visit: `http://localhost:3000`

## 🌐 Usage

### Via x402scan.com

1. Go to x402scan.com
2. Search for "POG" or paste your API URL
3. Click "Fetch" and pay 1 USDC
4. Receive 10,000 POG tokens automatically

### Via x402 Compatible Wallet

1. Send GET request to `/mint`
2. Wallet displays payment request
3. Pay 1 USDC
4. Receive 10,000 POG tokens

### Via API Directly

```bash
# Step 1: Get 402 response
curl https://your-api.com/mint

# Step 2: Pay 1 USDC to the payment address

# Step 3: Call with payment proof
curl -H "X-Payment-Tx: YOUR_TX_HASH" https://your-api.com/mint
```

## 🔧 Configuration

### Environment Variables

- `PRIVATE_KEY`: Your wallet private key (must have POG tokens)
- `POG_CONTRACT_ADDRESS`: POG token contract address
- `PORT`: Server port (default: 3000)

### Contract Addresses

- **USDC (Base Mainnet):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **POG Token:** Set in `.env`
- **Payment Address:** Derived from `PRIVATE_KEY`

## 📦 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import to Vercel
3. Add environment variables:
   - `PRIVATE_KEY`
   - `POG_CONTRACT_ADDRESS`
4. Deploy

### Railway / Render

1. Connect GitHub repo
2. Add environment variables
3. Deploy

## 🔐 Security

- ✅ Private key stored in environment variables only
- ✅ Payment verification via blockchain transactions
- ✅ No sensitive data in code
- ✅ `.env` file excluded from git

## 📝 x402 Schema

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "1000000",
    "resource": "/mint",
    "description": "Mint 10,000 $POG tokens",
    "mimeType": "application/json",
    "payTo": "YOUR_WALLET_ADDRESS",
    "maxTimeoutSeconds": 300,
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }]
}
```

## 🆘 Troubleshooting

### "Transaction not found"
- Wait for transaction confirmation on blockchain (1-2 minutes)

### "Invalid payment amount"
- Must send at least 1 USDC
- Verify using USDC on Base Mainnet

### "Payment already processed"
- This transaction was already used
- Check transaction hash

### "Insufficient balance"
- Wallet needs ETH for gas fees
- Wallet needs POG tokens to mint

## 📊 Next Steps

1. Deploy API to production (Vercel/Railway/Render)
2. Register on x402scan.com
3. Share URL with community
4. Monitor transactions and statistics

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

## 📞 Support

For issues or questions, please open an issue on GitHub.


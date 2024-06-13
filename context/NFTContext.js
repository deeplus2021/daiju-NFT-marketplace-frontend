import React, { useEffect, useState } from 'react';
import {
  createWeb3Modal,
  defaultConfig,
  useWeb3ModalProvider,
  useWeb3ModalAccount
} from '@web3modal/ethers/react';
import {
  ethers,
  BrowserProvider,
  EtherscanProvider,
  Contract,
  parseUnits
} from 'ethers';
import axios from 'axios';
import { create as ipfsHttpClient } from 'ipfs-http-client';

import { MarketAddress, MarketAddressABI } from './constants';

// 1. Get projectId
const projectId = "cba0c35b78c814139adc09164a5a7ab6"
if (!projectId) {
  throw new Error('PROJECT_ID is not set')
}

// 2. Set chains
const chains = [
  {
    chainId: 1,
    name: 'Ethereum',
    currency: 'ETH',
    explorerUrl: 'https://etherscan.io',
    rpcUrl: 'https://cloudflare-eth.com'
  },
  {
    chainId: 11155111,
    name: 'Sepolia',
    currency: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io/',
    rpcUrl: 'https://rpc2.sepolia.org'
  }
];

const ethersConfig = defaultConfig({
  metadata: {
    name: 'daiju-nft-marketplace',
    description: 'Web3Modal Laboratory',
    url: 'https://web3modal.com',
    icons: ['https://avatars.githubusercontent.com/u/37784886']
  },
  enableEmail: true,
  defaultChainId: 11155111,
  rpcUrl: 'https://cloudflare-eth.com'
});

// 3. Create modal
createWeb3Modal({
  ethersConfig,
  chains,
  projectId,
  enableAnalytics: true,
  themeMode: 'light',
  themeVariables: {
    '--w3m-color-mix': '#00DCFF',
    '--w3m-color-mix-strength': 20
  }
});

const subdomainName = 'daijuplace';

const ipfsProjectId = process.env.NEXT_PUBLIC_IPFS_PROJECT_ID;
const projectSecret = process.env.NEXT_PUBLIC_API_KEY_SECRET;
const auth = `Basic ${Buffer.from(`${ipfsProjectId}:${projectSecret}`).toString(
  'base64',
)}`;

const endpointBasePath = `https://${subdomainName}.infura-ipfs.io/ipfs/`;

const apiKey = process.env.NEXT_PUBLICE_PINATA_API_KEY;
const secretKey = process.env.NEXT_PUBLIC_PINATA_API_SECRET;

const client = ipfsHttpClient({
  host: 'ipfs.infura.io',
  port: 5001,
  protocol: 'https',
  headers: {
    authorization: auth,
  },
});

const fetchContract = (signerOrProvider) => new Contract(MarketAddress, MarketAddressABI, signerOrProvider);

export const NFTContext = React.createContext();

export const NFTProvider = ({ children }) => {
  const nftCurrency = 'ETH';
  const [currentAccount, setCurrentAccount] = useState('');
  const { address, chainId, isConnected } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const [isLoadingNFT, setIsLoadingNFT] = useState(false);

  const checkIfWalletIsConnect = async () => {
    if (!isConnected) {
      setCurrentAccount('');
      return 'Please install MetaMask.';
    } else {
      setCurrentAccount(address);
    }
  };

  useEffect(() => {
    checkIfWalletIsConnect();
  }, [address, isConnected]);

  const uploadToIPFS = async (file) => {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const resFile = await axios({
        method: "post",
        url: "https://api.pinata.cloud/pinning/pinFileToIPFS",
        data: formData,
        headers: {
          'pinata_api_key': `${process.env.NEXT_PUBLIC_PINATA_API_KEY}`,
          'pinata_secret_api_key': `${process.env.NEXT_PUBLIC_PINATA_API_SECRET}`,
          "Content-Type": "multipart/form-data"
        },
      });

      const ImgHash = `https://gateway.pinata.cloud/ipfs/${resFile.data.IpfsHash}`;
      console.log(ImgHash);
      return ImgHash;
      //Take a look at your Pinata Pinned section, you will see a new file added to you list.   
    } catch (error) {
      console.log("Error sending File to IPFS: ")
      console.log(error)
    }
  };

  const createSale = async (url, formInputPrice, isReselling, id) => {
    const ethersProvider = new BrowserProvider(walletProvider);
    const signer = ethersProvider.getSigner();

    const price = parseUnits(formInputPrice, 'ether');
    const contract = fetchContract(signer);
    const listingPrice = await contract.getListingPrice();

    const transaction = !isReselling
      ? await contract.createToken(url, price, {
        value: listingPrice.toString(),
      })
      : await contract.resellToken(id, price, {
        value: listingPrice.toString(),
      });

    setIsLoadingNFT(true);
    await transaction.wait();
  };

  const createNFT = async (formInput, fileUrl, router) => {
    const { name, description, price } = formInput;

    if (!name || !description || !price || !fileUrl) return;

    const data = JSON.stringify({ name, description, image: fileUrl });

    try {
      const added = await client.add(data);
      const url = endpointBasePath + added.path;

      console.log(`Created NFT url: ${url}`);

      await createSale(url, price);

      router.push('/');
    } catch (error) {
      console.log('error uploading file');
    }
  };

  const fetchNFTs = async () => {
    setIsLoadingNFT(false);
    const provider = new EtherscanProvider('sepolia');
    const contract = fetchContract(provider);
    const data = await contract.fetchMarketItems();

    const items = await Promise.all(
      data.map(async ({ tokenId, seller, owner, price: unformattedPrice }) => {
        const tokenURI = await contract.tokenURI(tokenId);
        console.log('data', tokenURI);
        try {
          const { data: { image, name, description } } = await axios.get(tokenURI);
          const price = ethers.utils.formatUnits(unformattedPrice.toString(), 'ether');

          // return an object with relevant properties
          return {
            price,
            tokenId: tokenId.toNumber(),
            seller,
            owner,
            image,
            name,
            description,
            tokenURI,
          };
        } catch (error) {
          if (error.response && error.response.status === 404) {
            // handle 404 error here
            console.log('Token URI not found.');
            return null;
          }
          // handle other errors here
          console.error(error);
          return null;
        }
      }),
    );

    return items;
  };

  const fetchMyNFTsOrListedNFTs = async (type) => {
    setIsLoadingNFT(false);
    const provider = new BrowserProvider(walletProvider);
    const signer = await provider.getSigner();

    const contract = fetchContract(signer);
    const data = type === 'fetchItemsListed'
      ? await contract.fetchItemsListed()
      : await contract.fetchMyNFTs();

    const items = await Promise.all(
      data.map(async ({ tokenId, seller, owner, price: unformattedPrice }) => {
        const tokenURI = await contract.tokenURI(tokenId);
        const {
          data: { image, name, description },
        } = await axios.get(tokenURI);
        const price = ethers.utils.formatUnits(
          unformattedPrice.toString(),
          'ether',
        );

        return {
          price,
          tokenId: tokenId.toNumber(),
          seller,
          owner,
          image,
          name,
          description,
          tokenURI,
        };
      }),
    );
    return items;
  };

  const buyNft = async (nft) => {
    const web3Modal = new Web3Modal();
    const connection = await web3Modal.connect();
    const provider = new ethers.providers.Web3Provider(connection);
    const signer = provider.getSigner();
    const contract = new ethers.Contract(
      MarketAddress,
      MarketAddressABI,
      signer,
    );

    const price = ethers.utils.parseUnits(nft.price.toString(), 'ether');
    const transaction = await contract.createMarketSale(nft.tokenId, {
      value: price,
    });

    setIsLoadingNFT(true);
    await transaction.wait();
    setIsLoadingNFT(false);
  };

  return (
    <NFTContext.Provider
      value={{
        nftCurrency,
        currentAccount,
        uploadToIPFS,
        createNFT,
        fetchNFTs,
        fetchMyNFTsOrListedNFTs,
        buyNft,
        createSale,
        isLoadingNFT,
      }}
    >
      {children}
    </NFTContext.Provider>
  );
};
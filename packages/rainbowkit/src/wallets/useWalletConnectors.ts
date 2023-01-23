import { Connector, useConnect } from 'wagmi';
import { flatten } from '../utils/flatten';
import { indexBy } from '../utils/indexBy';
import { isNotNullish } from '../utils/isNotNullish';
import {
  useInitialChainId,
  useRainbowKitChains,
} from './../components/RainbowKitProvider/RainbowKitChainContext';
import { WalletInstance } from './Wallet';
import { addRecentWalletId, getRecentWalletIds } from './recentWalletIds';

export interface WalletConnector extends WalletInstance {
  ready?: Boolean;
  connect?: ReturnType<typeof useConnect>['connectAsync'];
  onConnecting?: (fn: () => void) => void;
  showWalletConnectModal?: () => void;
  recent: boolean;
}

export function useWalletConnectors(): WalletConnector[] {
  console.time('testing')
  const rainbowKitChains = useRainbowKitChains();
  const intialChainId = useInitialChainId();
  const { connectAsync, connectors: defaultConnectors_untyped } = useConnect();
  const defaultConnectors = defaultConnectors_untyped as Connector[];

  async function connectWallet(walletId: string, connector: Connector) {
    const walletChainId = await connector.getChainId();
    const result = await connectAsync({
      chainId:
        // The goal here is to ensure users are always on a supported chain when connecting.
        // If an `initialChain` prop was provided to RainbowKitProvider, use that.
        intialChainId ??
        // Otherwise, if the wallet is already on a supported chain, use that to avoid a chain switch prompt.
        rainbowKitChains.find(({ id }) => id === walletChainId)?.id ??
        // Finally, fall back to the first chain provided to RainbowKitProvider.
        rainbowKitChains[0]?.id,
      connector,
    });

    if (result) {
      addRecentWalletId(walletId);
    }

    return result;
  }

  const walletInstances = flatten(
    defaultConnectors.map(connector => {
      // @ts-expect-error
      return (connector._wallets as WalletInstance[]) ?? [];
    })
  ).sort((a, b) => a.index - b.index);

  const walletInstanceById = indexBy(
    walletInstances,
    walletInstance => walletInstance.id
  );

  const MAX_RECENT_WALLETS = 3;
  const recentWallets: WalletInstance[] = getRecentWalletIds()
    .map(walletId => walletInstanceById[walletId])
    .filter(isNotNullish)
    .slice(0, MAX_RECENT_WALLETS);

  const groupedWallets: WalletInstance[] = [
    ...recentWallets,
    ...walletInstances.filter(
      walletInstance => !recentWallets.includes(walletInstance)
    ),
  ];

  const walletConnectors: WalletConnector[] = [];

  function pollWallet(wallet: WalletInstance, numberOfPolls: number): Boolean {
    console.log('WALLET',wallet.id)
    for(let i = 0; i < numberOfPolls; i++) {
      console.log('wallet.installed ?? true', wallet.installed ?? true)
      console.log('wallet.installed == true', wallet.installed == true)
      if((wallet.installed ?? true) && wallet.connector.ready) return true
    }
      return false
  }
  groupedWallets.forEach((wallet: WalletInstance) => {
    if (!wallet) {
      return;
    }

    const recent = recentWallets.includes(wallet);

    walletConnectors.push({
      ...wallet,
      connect: () => connectWallet(wallet.id, wallet.connector),
      groupName: wallet.groupName,
      onConnecting: (fn: () => void) =>
        wallet.connector.on('message', ({ type }) =>
          type === 'connecting' ? fn() : undefined
        ),
      ready: pollWallet(wallet, 20),
      recent,
      showWalletConnectModal: wallet.walletConnectModalConnector
        ? async () => {
            try {
              await connectWallet(
                wallet.id,
                wallet.walletConnectModalConnector!
              );
            } catch (err) {
              // @ts-expect-error
              const isUserRejection = err.name === 'UserRejectedRequestError';

              if (!isUserRejection) {
                throw err;
              }
            }
          }
        : undefined,
    });
  });
  console.timeEnd('testing')
  walletConnectors.forEach((wallet, i) => console.log(i, ":", wallet.id, 'ready:',wallet.ready, 'installed:',wallet.installed, 'connector', wallet.connector.ready))
  return walletConnectors;
}

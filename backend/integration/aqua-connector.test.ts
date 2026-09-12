import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import test from 'node:test';
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  decodeFunctionResult,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import {
  AquaConnector,
  aquaAbi,
  swapVmAbi,
  type ContractCall,
} from '../src/services/aqua-connector.js';

// Always starts a fresh local chain. Never reads .env, keys, or an external RPC URL.
for (const usdcFirst of [true, false])
  test(
    `Sepolia lifecycle with ${usdcFirst ? 'USDC' : 'WETH'} as tokenLt`,
    { timeout: 180_000 },
    async (t) => {
      const anvil = spawn(
        'anvil',
        ['--host', '127.0.0.1', '--port', '0', '--chain-id', '11155111'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      t.after(async () => {
        if (anvil.exitCode === null && anvil.signalCode === null) {
          const exited = once(anvil, 'exit');
          anvil.kill('SIGTERM');
          await exited;
        }
      });
      const url = await new Promise<string>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Local Anvil startup timed out')), 10_000);
        anvil.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        anvil.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Local Anvil exited'));
        });
        anvil.stdout.on('data', (data: Buffer) => {
          output += data.toString();
          const match = /Listening on 127\.0\.0\.1:(\d+)/.exec(output);
          if (match) {
            clearTimeout(timer);
            resolve(`http://127.0.0.1:${match[1]}`);
          }
        });
      });
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(url),
        pollingInterval: 10,
      });
      const accounts = await createWalletClient({
        chain: sepolia,
        transport: http(url),
      }).getAddresses();
      const owner = getAddress(accounts[0]!);
      const taker = getAddress(accounts[1]!);
      const ownerClient = createWalletClient({
        account: owner,
        chain: sepolia,
        transport: http(url),
      });
      const takerClient = createWalletClient({
        account: taker,
        chain: sepolia,
        transport: http(url),
      });
      const artifact = async (file: string, name: string) =>
        JSON.parse(
          await readFile(
            new URL(`../../contracts/out/${file}/${name}.json`, import.meta.url),
            'utf8',
          ),
        ) as { abi: Abi; bytecode: { object: Hex } };
      async function receipt(hash: Hex) {
        const result = await publicClient.waitForTransactionReceipt({ hash });
        assert.equal(result.status, 'success');
        return result;
      }
      async function deploy(file: string, name: string, args: readonly unknown[] = []) {
        const compiled = await artifact(file, name);
        const result = await receipt(
          await ownerClient.deployContract({
            abi: compiled.abi,
            bytecode: compiled.bytecode.object,
            args,
          }),
        );
        assert.ok(result.contractAddress);
        return { address: getAddress(result.contractAddress), abi: compiled.abi };
      }
      async function write(
        contract: { address: Address; abi: Abi },
        name: string,
        args: readonly unknown[] = [],
      ) {
        return receipt(await ownerClient.writeContract({ ...contract, functionName: name, args }));
      }
      const read = (
        contract: { address: Address; abi: Abi },
        name: string,
        args: readonly unknown[] = [],
      ) => publicClient.readContract({ ...contract, functionName: name, args });
      const send = async (call: ContractCall, isTaker = true) =>
        receipt(await (isTaker ? takerClient : ownerClient).sendTransaction(call));
      const simulate = (call: ContractCall) => publicClient.call({ ...call, account: taker });

      const first = await deploy('StarFamilyVault.t.sol', 'MockERC20');
      const second = await deploy('StarFamilyVault.t.sol', 'MockERC20');
      const [lower, upper] =
        BigInt(first.address) < BigInt(second.address) ? [first, second] : [second, first];
      const [usdc, weth] = usdcFirst ? [lower, upper] : [upper, lower];
      const [tokenA, tokenB] = [lower, upper];
      await write(weth, 'setDecimals', [18]);
      await write(usdc, 'setDecimals', [6]);
      const aqua = await deploy('Aqua.sol', 'Aqua');
      const router = await deploy('AquaSwapVMRouter.sol', 'AquaSwapVMRouter', [
        aqua.address,
        weth.address,
        owner,
        'SwapVM',
        '1',
      ]);
      const connector = new AquaConnector({ aqua: aqua.address, swapVm: router.address });
      const harness = await deploy('AquaConnectorHarness.sol', 'AquaConnectorHarness');
      const now = (await publicClient.getBlock()).timestamp;
      const deadline = now + 900n;
      const input = {
        maker: owner,
        tokenA: tokenA.address,
        tokenB: tokenB.address,
        rawPriceMin: usdcFirst ? 475_000_000_000_000_000_000_000_000n : 1_900_000_000n,
        rawPriceMax: usdcFirst ? 525_000_000_000_000_000_000_000_000n : 2_100_000_000n,
        feeBps: 30,
        salt: 77n,
        deadline,
      };

      await t.test(
        'byte-for-byte orders and taker traits agree with official Solidity builders',
        async () => {
          for (const feeBps of [0, 1, 30, 1_000]) {
            const built = AquaConnector.buildOrder({ ...input, feeBps });
            assert.equal(
              built.strategy,
              await read(harness, 'buildOrder', [
                owner,
                tokenA.address,
                tokenB.address,
                input.rawPriceMin,
                input.rawPriceMax,
                feeBps,
                input.salt,
                deadline,
              ]),
            );
            assert.equal(built.strategyHash, await read(router, 'hash', [built.order]));
            for (const isAToB of [false, true]) {
              const swapInput = {
                strategy: built.strategy,
                tokenIn: isAToB ? tokenA.address : tokenB.address,
                tokenOut: isAToB ? tokenB.address : tokenA.address,
                amount: 1n,
              };
              for (const minimumOutput of [0n, 1n, maxUint256]) {
                const call = minimumOutput
                  ? connector.swap({ ...swapInput, minimumOutput, deadline })
                  : connector.quote(swapInput);
                const decoded = decodeFunctionData({ abi: swapVmAbi, data: call.data });
                assert.equal(
                  decoded.args?.[2],
                  await read(harness, 'buildTaker', [
                    isAToB,
                    minimumOutput,
                    minimumOutput ? deadline : 0n,
                  ]),
                );
              }
            }
          }
        },
      );

      const registry = await deploy('StarFamilyVault.t.sol', 'MockRegistry', [owner]);
      const star = await deploy('StarFamilyVault.t.sol', 'MockStar');
      const ethFeed = await deploy('StarFamilyVault.t.sol', 'MockFeed', [8, 2_000_00000000n, now]);
      const usdcFeed = await deploy('StarFamilyVault.t.sol', 'MockFeed', [8, 100000000n, now]);
      const vault = await deploy('StarFamilyVault.sol', 'StarFamilyVault', [
        1n,
        usdc.address,
        weth.address,
        registry.address,
        star.address,
        aqua.address,
        router.address,
        owner,
        {
          ethUsdFeed: ethFeed.address,
          usdcUsdFeed: usdcFeed.address,
          ethUsdMaxAgeSeconds: 3_600,
          usdcUsdMaxAgeSeconds: 90_000,
          maxStrategyPriceDeviationBps: 1_000,
          maxStrategyLifetimeSeconds: 1_800,
          maxPositionUsdc: 1_000_000_000n,
          maxPositionWeth: 500_000_000_000_000_000n,
        },
        (await deploy('StarQuestsFactory.sol', 'StarQuestsFactory')).address,
      ]);
      const usdcAmount = 100_000_000n;
      const wethAmount = 50_000_000_000_000_000n;
      await write(usdc, 'mint', [owner, usdcAmount]);
      await write(weth, 'mint', [owner, wethAmount]);
      await write(usdc, 'approve', [vault.address, usdcAmount]);
      await write(weth, 'approve', [vault.address, wethAmount]);
      await write(vault, 'rewardStars', [1n, 100n, 'local connector test']);
      await write(vault, 'fundStrategyWeth', [wethAmount]);
      const built = AquaConnector.buildOrder({ ...input, maker: vault.address });
      assert.equal(
        await read(vault, 'currentOracleRawPrice'),
        usdcFirst ? 500_000_000_000_000_000_000_000_000n : 2_000_000_000n,
      );
      await read(vault, 'inspectSavingsStrategy', [built.strategy]);
      await write(vault, 'shipSavingsPosition', [built.strategy, usdcAmount, wethAmount]);
      assert.deepEqual(await read(vault, 'currentPositionBalances'), [usdcAmount, wethAmount]);
      await write(usdc, 'mint', [taker, 10_000_000n]);
      await write(weth, 'mint', [taker, 1_000_000_000_000_000n]);
      for (const token of [usdc, weth]) {
        await receipt(
          await takerClient.writeContract({
            ...token,
            functionName: 'approve',
            args: [router.address, maxUint256],
          }),
        );
      }
      const forward = {
        strategy: built.strategy,
        tokenIn: usdc.address,
        tokenOut: weth.address,
        amount: 1_000_000n,
      };

      await t.test(
        'rejects unsafe slippage and expired taker deadlines on the real router',
        async () => {
          await assert.rejects(
            simulate(connector.swap({ ...forward, minimumOutput: maxUint256, deadline })),
          );
          await assert.rejects(
            simulate(connector.swap({ ...forward, minimumOutput: 1n, deadline: now - 1n })),
          );
          // The curve can propose a partial fill when liquidity is exhausted; our
          // taker flags require the full exact input and must reject that quote.
          await assert.rejects(
            simulate(connector.quote({ ...forward, amount: 1_000_000_000_000n })),
          );
        },
      );
      await t.test(
        'executes both swap directions and reconciles vault/token balances',
        async () => {
          for (const params of [
            forward,
            {
              ...forward,
              tokenIn: weth.address,
              tokenOut: usdc.address,
              amount: 100_000_000_000_000n,
            },
          ]) {
            const quoteRaw = await simulate(connector.quote(params));
            assert.ok(quoteRaw.data);
            const [amountIn, amountOut, hash] = decodeFunctionResult({
              abi: swapVmAbi,
              functionName: 'quote',
              data: quoteRaw.data,
            });
            assert.equal(amountIn, params.amount);
            assert.ok(amountOut > 0n);
            assert.equal(hash, built.strategyHash);
            const inputToken = params.tokenIn === usdc.address ? usdc : weth;
            const outputToken = params.tokenOut === usdc.address ? usdc : weth;
            const beforeIn = (await read(inputToken, 'balanceOf', [taker])) as bigint;
            const beforeOut = (await read(outputToken, 'balanceOf', [taker])) as bigint;
            const result = await send(
              connector.swap({ ...params, minimumOutput: amountOut, deadline }),
            );
            const [event] = parseEventLogs({
              abi: swapVmAbi,
              eventName: 'Swapped',
              logs: result.logs.filter((log) => getAddress(log.address) === router.address),
            });
            assert.ok(event);
            assert.equal(event.args.amountIn, amountIn);
            assert.equal(event.args.amountOut, amountOut);
            assert.equal(event.args.orderHash, built.strategyHash);
            assert.equal(
              beforeIn - ((await read(inputToken, 'balanceOf', [taker])) as bigint),
              amountIn,
            );
            assert.equal(
              ((await read(outputToken, 'balanceOf', [taker])) as bigint) - beforeOut,
              amountOut,
            );
          }
          const balances = await read(vault, 'currentPositionBalances');
          assert.deepEqual(balances, [
            await read(usdc, 'balanceOf', [vault.address]),
            await read(weth, 'balanceOf', [vault.address]),
          ]);
        },
      );
      await t.test(
        'revokes spending on pause, docks and withdraws the actual inventory',
        async () => {
          await write(vault, 'setAquaPaused', [true]);
          assert.equal(await read(usdc, 'allowance', [vault.address, aqua.address]), 0n);
          assert.equal(await read(weth, 'allowance', [vault.address, aqua.address]), 0n);
          await assert.rejects(
            simulate(connector.swap({ ...forward, minimumOutput: 1n, deadline })),
          );
          await write(vault, 'emergencyDockSavingsPosition');
          const usdcBalance = (await read(usdc, 'balanceOf', [vault.address])) as bigint;
          const wethBalance = (await read(weth, 'balanceOf', [vault.address])) as bigint;
          await write(vault, 'withdrawSavings', [usdcBalance, owner]);
          await write(vault, 'withdrawStrategyWeth', [wethBalance, owner]);
          assert.equal(await read(usdc, 'balanceOf', [vault.address]), 0n);
          assert.equal(await read(weth, 'balanceOf', [vault.address]), 0n);
          assert.equal(await read(usdc, 'balanceOf', [owner]), usdcBalance);
          assert.equal(await read(weth, 'balanceOf', [owner]), wethBalance);
        },
      );
      await t.test(
        'direct maker ship/dock works and an expired maker order cannot be quoted',
        async () => {
          await write(usdc, 'approve', [aqua.address, maxUint256]);
          await write(weth, 'approve', [aqua.address, maxUint256]);
          const direct = AquaConnector.buildOrder({ ...input, salt: 99n });
          await send(
            connector.ship({ strategy: direct.strategy, amountA: 1n, amountB: 1n }),
            false,
          );
          assert.deepEqual(
            await publicClient.readContract({
              address: aqua.address,
              abi: aquaAbi,
              functionName: 'safeBalances',
              args: [owner, router.address, keccak256(direct.strategy), weth.address, usdc.address],
            }),
            [1n, 1n],
          );
          await send(connector.dock(direct.strategy), false);
          await assert.rejects(
            simulate(connector.quote({ ...forward, strategy: direct.strategy })),
          );
          const expiring = AquaConnector.buildOrder({ ...input, salt: 100n });
          await send(
            connector.ship({
              strategy: expiring.strategy,
              amountA: (usdcFirst ? usdcAmount : wethAmount) / 2n,
              amountB: (usdcFirst ? wethAmount : usdcAmount) / 2n,
            }),
            false,
          );
          await publicClient.request({
            method: 'evm_setNextBlockTimestamp' as never,
            params: [Number(deadline + 1n)] as never,
          });
          await publicClient.request({ method: 'evm_mine' as never });
          await assert.rejects(
            simulate(connector.quote({ ...forward, strategy: expiring.strategy })),
          );
          await send(connector.dock(expiring.strategy), false);
        },
      );
    },
  );

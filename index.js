
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Chest Transfer Bot is running');
});

app.listen(8000, () => {
  console.log('Server started');
});

function createBot() {
   const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      auth: config['bot-account']['type'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
      keepAlive: true,
      checkTimeoutInterval: 30000,
      hideErrors: false
   });

   bot.loadPlugin(pathfinder);
   const mcData = require('minecraft-data')(bot.version);
   const defaultMove = new Movements(bot, mcData);
   bot.pathfinder.setMovements(defaultMove);
   bot.settings.colorsEnabled = false;

   let connectionStable = false;
   let lastPacketTime = Date.now();
   let isTransferring = false;
   let transferCount = 0;

   // Connection monitoring
   bot.on('packet', () => {
      lastPacketTime = Date.now();
      if (!connectionStable) {
         connectionStable = true;
         console.log('\x1b[32m[Connection] Connection stabilized', '\x1b[0m');
      }
   });

   // Periodic connection health check
   setInterval(() => {
      const timeSinceLastPacket = Date.now() - lastPacketTime;
      if (timeSinceLastPacket > 60000) {
         console.log('\x1b[31m[Connection] No packets received for 60s, connection may be lost', '\x1b[0m');
         connectionStable = false;
      }
   }, 30000);

   bot.once('spawn', () => {
      console.log('\x1b[33m[ChestBot] Bot spawned! Starting chest transfer operations...', '\x1b[0m');
      connectionStable = true;

      setTimeout(() => {
         startChestTransferLoop();
      }, 3000);

      function startChestTransferLoop() {
         console.log('\x1b[36m[ChestBot] Starting continuous chest transfer system', '\x1b[0m');

         async function findNearbyChests() {
            try {
               const chests = bot.findBlocks({
                  matching: (block) => {
                     return block.name === 'chest' || 
                            block.name === 'trapped_chest' || 
                            block.name === 'ender_chest';
                  },
                  maxDistance: 10,
                  count: 10
               });

               return chests.map(pos => bot.blockAt(pos)).filter(block => block);
            } catch (error) {
               console.log('\x1b[31m[ChestBot] Error finding chests:', error.message, '\x1b[0m');
               return [];
            }
         }

         async function transferItemsBetweenChests() {
            if (isTransferring || !connectionStable) {
               return;
            }

            try {
               isTransferring = true;
               console.log('\x1b[34m[Transfer] Starting item transfer cycle #' + (transferCount + 1), '\x1b[0m');

               const chests = await findNearbyChests();
               
               if (chests.length < 2) {
                  console.log('\x1b[33m[Transfer] Need at least 2 chests nearby. Found:', chests.length, '\x1b[0m');
                  isTransferring = false;
                  return;
               }

               // Select source and target chests
               const sourceChest = chests[Math.floor(Math.random() * chests.length)];
               let targetChest;
               do {
                  targetChest = chests[Math.floor(Math.random() * chests.length)];
               } while (targetChest === sourceChest && chests.length > 1);

               console.log(`\x1b[36m[Transfer] Source: ${sourceChest.name} at (${sourceChest.position.x}, ${sourceChest.position.y}, ${sourceChest.position.z})`, '\x1b[0m');
               console.log(`\x1b[36m[Transfer] Target: ${targetChest.name} at (${targetChest.position.x}, ${targetChest.position.y}, ${targetChest.position.z})`, '\x1b[0m');

               // Move to source chest
               await bot.pathfinder.goto(new goals.GoalNear(
                  sourceChest.position.x, 
                  sourceChest.position.y, 
                  sourceChest.position.z, 
                  1
               ));

               await bot.waitForTicks(10); // Small delay

               // Open source chest
               const sourceWindow = await bot.openContainer(sourceChest);
               console.log('\x1b[32m[Transfer] Opened source chest', '\x1b[0m');

               // Find items to transfer
               const availableItems = sourceWindow.slots.slice(0, sourceWindow.inventoryStart).filter(slot => slot);
               
               if (availableItems.length === 0) {
                  console.log('\x1b[33m[Transfer] Source chest is empty, trying next cycle', '\x1b[0m');
                  sourceWindow.close();
                  isTransferring = false;
                  return;
               }

               // Select item to transfer (prefer stacks with multiple items)
               const itemToTransfer = availableItems.find(item => item.count > 1) || availableItems[0];
               const transferAmount = Math.min(itemToTransfer.count, Math.floor(Math.random() * 3) + 1); // Transfer 1-3 items

               console.log(`\x1b[35m[Transfer] Taking ${transferAmount}x ${itemToTransfer.name} from source chest`, '\x1b[0m');

               // Withdraw item from source chest
               await sourceWindow.withdraw(itemToTransfer.type, null, transferAmount);
               await bot.waitForTicks(5);
               
               sourceWindow.close();
               console.log('\x1b[32m[Transfer] Closed source chest', '\x1b[0m');

               // Move to target chest
               await bot.pathfinder.goto(new goals.GoalNear(
                  targetChest.position.x, 
                  targetChest.position.y, 
                  targetChest.position.z, 
                  1
               ));

               await bot.waitForTicks(10);

               // Open target chest
               const targetWindow = await bot.openContainer(targetChest);
               console.log('\x1b[32m[Transfer] Opened target chest', '\x1b[0m');

               // Check if we have the item in inventory
               const inventoryItem = bot.inventory.items().find(item => item.type === itemToTransfer.type);
               
               if (inventoryItem) {
                  const depositAmount = Math.min(inventoryItem.count, transferAmount);
                  await targetWindow.deposit(inventoryItem.type, null, depositAmount);
                  console.log(`\x1b[32m[Transfer] ✅ Successfully deposited ${depositAmount}x ${inventoryItem.name} into target chest`, '\x1b[0m');
                  transferCount++;
               } else {
                  console.log('\x1b[31m[Transfer] ❌ Item not found in inventory after withdrawal', '\x1b[0m');
               }

               targetWindow.close();
               console.log('\x1b[32m[Transfer] Closed target chest', '\x1b[0m');
               console.log(`\x1b[36m[Transfer] ✨ Transfer cycle completed! Total transfers: ${transferCount}`, '\x1b[0m');

            } catch (error) {
               console.log('\x1b[31m[Transfer] Error during transfer:', error.message, '\x1b[0m');
               
               // Try to close any open containers
               try {
                  if (bot.currentWindow) {
                     bot.closeWindow(bot.currentWindow);
                  }
               } catch (closeError) {
                  console.log('\x1b[31m[Transfer] Error closing window:', closeError.message, '\x1b[0m');
               }
            } finally {
               isTransferring = false;
            }
         }

         // Main transfer loop - runs every 4-8 seconds
         const transferInterval = setInterval(async () => {
            if (connectionStable && bot.entity && !isTransferring) {
               await transferItemsBetweenChests();
            }
         }, Math.random() * 4000 + 4000); // 4-8 second intervals

         // Status reporting every 30 seconds
         const statusInterval = setInterval(() => {
            if (connectionStable) {
               console.log(`\x1b[36m[Status] Bot is running | Total transfers completed: ${transferCount}`, '\x1b[0m');
            }
         }, 30000);

         // Clear intervals on bot end
         bot.on('end', () => {
            clearInterval(transferInterval);
            clearInterval(statusInterval);
         });
      }
   });

   bot.on('goal_reached', () => {
      console.log('\x1b[32m[Movement] Reached target position', '\x1b[0m');
   });

   bot.on('death', () => {
      console.log('\x1b[33m[ChestBot] Bot died and respawned', '\x1b[0m');
      transferCount = 0; // Reset counter on death
   });

   bot.on('kicked', (reason) => {
      console.log('\x1b[33m[ChestBot] Bot was kicked:', reason, '\x1b[0m');
   });

   bot.on('error', (err) => {
      console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m');
      connectionStable = false;

      if (err.code === 'ECONNRESET') {
         console.log('\x1b[33m[INFO] Server reset connection - reconnecting automatically', '\x1b[0m');
      } else if (err.code === 'ENOTFOUND') {
         console.log('\x1b[33m[INFO] Server not found - check server address', '\x1b[0m');
      } else if (err.code === 'ETIMEDOUT') {
         console.log('\x1b[33m[INFO] Connection timed out - retrying', '\x1b[0m');
      } else if (err.code === 'ECONNREFUSED') {
         console.log('\x1b[33m[INFO] Connection refused - server may be offline', '\x1b[0m');
      }
   });

   bot.on('end', (reason) => {
      console.log('\x1b[33m[INFO] Connection ended:', reason || 'Unknown reason', '\x1b[0m');
      connectionStable = false;

      if (config.utils['auto-reconnect']) {
         const delay = config.utils['auto-recconect-delay'];
         console.log(`\x1b[33m[INFO] Reconnecting in ${delay} seconds...`, '\x1b[0m');

         setTimeout(() => {
            console.log('\x1b[32m[INFO] Attempting to reconnect...', '\x1b[0m');
            try {
               createBot();
            } catch (reconnectError) {
               console.log('\x1b[31m[ERROR] Reconnection failed:', reconnectError.message, '\x1b[0m');
               setTimeout(() => createBot(), delay * 1000);
            }
         }, delay * 1000);
      }
   });
}

createBot();

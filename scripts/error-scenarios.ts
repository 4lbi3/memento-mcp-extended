#!/usr/bin/env node
import 'dotenv/config';
import { initializeStorageProvider } from '../dist/config/storage.js';
import { KnowledgeGraphManager } from '../dist/KnowledgeGraphManager.js';

async function main(): Promise<void> {
  const storageProvider = initializeStorageProvider();
  const searchManager = new KnowledgeGraphManager({
    storageProvider,
  });

  console.log('1) Semantic search fallback (no embedding job manager configured):');
  const fallbackStart = Date.now();
  const fallbackResult = await searchManager.search('integration error scenario', {
    semanticSearch: true,
    limit: 5,
  });
  console.log(`   searchType=${fallbackResult.searchType}`);
  console.log(`   fallbackReason=${fallbackResult.fallbackReason}`);
  console.log(`   durationMs=${Date.now() - fallbackStart}`);
  console.log('   diagnostics:', fallbackResult.searchDiagnostics);

  console.log('\n2) Strict mode enforcement should throw when fallback occurs:');
  try {
    await searchManager.search('integration error scenario', {
      semanticSearch: true,
      strictMode: true,
    });
  } catch (error) {
    console.log(
      '   strict-mode error caught:',
      error instanceof Error ? error.message : String(error)
    );
  }

  console.log('\n3) Keyword search baseline for performance measurement:');
  const keywordStart = Date.now();
  const keywordResult = await searchManager.search('integration performance check', {
    limit: 10,
    semanticSearch: false,
  });
  console.log(
    `   entities=${keywordResult.entities.length}, durationMs=${Date.now() - keywordStart}`
  );
  console.log('   diagnostics:', keywordResult.searchDiagnostics);
  if (typeof storageProvider.close === 'function') {
    await storageProvider.close();
  }
}

main().catch((error) => {
  console.error('Error-scenario script failed:', error);
  process.exit(1);
});

import React from 'react';
import { ApiTable } from '@/components/ApiTable';
import { getBookPLColumns, getBookFundData } from '@/services/api';

export default function FundBook() {
  // Fund data reuses P&L columns per captured behavior.
  return (
    <ApiTable
      title="Fund Book"
      fetchColumns={getBookPLColumns}
      fetchData={(p) => getBookFundData(p)}
    />
  );
}

import React from 'react';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { FillOrderOperation } from '../types/hive';
import { formatCurrency } from '../utils/calculations';
import { format } from 'date-fns';
import { Locale } from 'date-fns';
import { TableLoadingRow } from './LoadingSpinner';

interface OperationsTableProps {
  operations: FillOrderOperation[];
  isLoading: boolean;
  t: (key: string) => string;
  dateLocale: Locale;
}

export function OperationsTable({ operations, isLoading, t, dateLocale }: OperationsTableProps) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <div className="p-6 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">
          {t('operationsTable.title')} {!isLoading && `(${operations.length})`}
        </h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-750">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                {t('operationsTable.date')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                {t('operationsTable.type')}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                HIVE
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                HBD
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                {t('operationsTable.price')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {isLoading ? (
              // Mostrar filas de carga mientras se obtienen los datos
              [...Array(8)].map((_, index) => (
                <TableLoadingRow key={index} />
              ))
            ) : operations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center">
                  <div className="text-gray-400 text-lg">{t('operationsTable.noOperations')}</div>
                  <div className="text-gray-500 text-sm mt-2">
                    {t('operationsTable.adjustFilters')}
                  </div>
                </td>
              </tr>
            ) : (
              operations.map((operation, index) => (
                <tr
                  key={index}
                  className="hover:bg-gray-750 transition-colors duration-150"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                    {format(new Date(operation.timestamp), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {operation.type === 'buy' ? (
                        <>
                          <ArrowUpRight className="h-4 w-4 text-green-400 mr-2" />
                          <span className="text-green-400 font-medium">{t('operationsTable.buy')}</span>
                        </>
                      ) : (
                        <>
                          <ArrowDownLeft className="h-4 w-4 text-red-400 mr-2" />
                          <span className="text-red-400 font-medium">{t('operationsTable.sell')}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-mono">
                    {formatCurrency(operation.hiveAmount)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-mono">
                    {formatCurrency(operation.hbdAmount)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-300 font-mono">
                    {formatCurrency(operation.price)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
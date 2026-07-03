import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { PositionRow } from './PositionRow'

export function PositionList({ positions, onAdd, onUpdate, onRemove, valuationDate, cdRate, quotes, result }) {
  // Maps each position to its own clean_npv from the last /api/portfolio/price
  // response, so every row can show its individual P&L -- null (not yet
  // computed / stale after an edit) until the user recalculates.
  const npvByPositionId = useMemo(
    () => new Map((result?.position_results ?? []).map((pr) => [pr.position_id, pr.clean_npv])),
    [result],
  )

  return (
    <div className="space-y-3">
      {positions.map((position) => (
        <PositionRow
          key={position.id}
          position={position}
          onChange={onUpdate}
          onRemove={onRemove}
          canRemove={positions.length > 1}
          valuationDate={valuationDate}
          cdRate={cdRate}
          quotes={quotes}
          npv={npvByPositionId.get(position.id) ?? null}
        />
      ))}
      <Button type="button" variant="outline" onClick={onAdd} className="w-full">
        + 포지션 추가
      </Button>
    </div>
  )
}

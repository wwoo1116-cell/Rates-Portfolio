import { Button } from '@/components/ui/button'
import { PositionRow } from './PositionRow'

export function PositionList({ positions, onAdd, onUpdate, onRemove }) {
  return (
    <div className="space-y-3">
      {positions.map((position) => (
        <PositionRow
          key={position.id}
          position={position}
          onChange={onUpdate}
          onRemove={onRemove}
          canRemove={positions.length > 1}
        />
      ))}
      <Button type="button" variant="outline" onClick={onAdd} className="w-full">
        + 포지션 추가
      </Button>
    </div>
  )
}

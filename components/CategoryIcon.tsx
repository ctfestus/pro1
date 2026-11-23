import { createElement } from 'react';

/**
 * An icon for a catalogue category or industry ("Fintech", "Health", "Data"...), picked from its
 * name so nobody has to choose one: the first matching word wins, and anything unknown gets a
 * neutral shape. Phosphor duotone, like the rest of the new UI.
 */
import {
  AirplaneTilt, Bank, Briefcase, Brain, Broadcast, Buildings, ChartBar, Code, Cpu, Cube, Database,
  Factory, FilmSlate, GraduationCap, HandHeart, Heartbeat, Lightning, LockKey, Megaphone, PaintBrush,
  Plant, Scales, Shapes, ShieldCheck, ShoppingBag, Table, Truck, UsersThree, type Icon,
} from '@phosphor-icons/react';

const RULES: [RegExp, Icon][] = [
  [/insur/i, ShieldCheck],
  [/fintech|financ|bank|account|invest|payment|audit|tax/i, Bank],
  [/health|medic|pharma|hospital|clinic|care\b/i, Heartbeat],
  [/retail|commerce|shop|fmcg|consumer/i, ShoppingBag],
  [/educat|edtech|school|teach|training/i, GraduationCap],
  [/telecom|communicat|network/i, Broadcast],
  [/energy|oil|gas|power|utilit|mining|solar/i, Lightning],
  [/agri|farm|food/i, Plant],
  [/logistic|supply|transport|shipping|freight/i, Truck],
  [/market|advert|brand|sales|growth/i, Megaphone],
  [/human resource|\bhr\b|people|recruit|talent/i, UsersThree],
  [/cyber|secur/i, LockKey],
  [/\bai\b|artificial|machine learning|generative|prompt/i, Brain],
  [/excel|spreadsheet/i, Table],
  [/sql|database/i, Database],
  [/python|programming|coding|\bcode\b|developer/i, Code],
  [/data|analytic|intelligence|\bbi\b|power bi|dashboard/i, ChartBar],
  [/tech|software|engineer|\bit\b|cloud|digital/i, Cpu],
  [/media|entertain|film|music/i, FilmSlate],
  [/design|creative|art\b/i, PaintBrush],
  [/nonprofit|non-profit|ngo|charity|development/i, HandHeart],
  [/government|public sector|policy|real estate|property|construction|urban/i, Buildings],
  [/hospitality|travel|tourism|aviation/i, AirplaneTilt],
  [/manufactur|industr/i, Factory],
  [/legal|\blaw\b|compliance/i, Scales],
  [/product/i, Cube],
  [/career|consult|management|strategy|operations|business/i, Briefcase],
];

export function categoryIcon(name: string): Icon {
  return RULES.find(([pattern]) => pattern.test(name))?.[1] ?? Shapes;
}

export function CategoryIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  return createElement(categoryIcon(name), { className, weight: 'duotone', 'aria-hidden': true });
}

import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { SearchableDropdownOption } from "./searchable-dropdown";

interface SearchableMultiSelectDropdownProps {
  values: string[];
  options: SearchableDropdownOption[];
  onValuesChange: (values: string[]) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  listClassName?: string;
  portalContainer?: HTMLElement | null;
}

export const SearchableMultiSelectDropdown: React.FC<
  SearchableMultiSelectDropdownProps
> = ({
  values,
  options,
  onValuesChange,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  ariaLabel,
  disabled = false,
  triggerClassName,
  contentClassName,
  listClassName,
  portalContainer,
}) => {
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");
  const selectedValues = React.useMemo(() => new Set(values), [values]);
  const selectedOptions = options.filter((option) =>
    selectedValues.has(option.value),
  );
  const triggerLabel =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length <= 2
        ? selectedOptions.map((option) => option.label).join(" + ")
        : `${selectedOptions.length} selected`;
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
  const filteredOptions = React.useMemo(
    () =>
      normalizedSearchTerm
        ? options.filter((option) =>
            [option.label, option.searchText ?? "", option.value].some((text) =>
              text.toLocaleLowerCase().includes(normalizedSearchTerm),
            ),
          )
        : options,
    [normalizedSearchTerm, options],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearchTerm("");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? triggerLabel}
          disabled={disabled}
          className={cn("justify-between", triggerClassName)}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[320px] p-0", contentClassName)}
        container={portalContainer}
      >
        <Command label={searchPlaceholder} loop shouldFilter={false}>
          <CommandInput
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
          <CommandList
            className={cn(
              "max-h-56 overflow-y-auto overscroll-contain",
              listClassName,
            )}
          >
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => {
                const selected = selectedValues.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    onSelect={() => {
                      onValuesChange(
                        selected
                          ? values.filter((value) => value !== option.value)
                          : [...values, option.value],
                      );
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <Separator />
        <div className="flex items-center justify-between gap-2 p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={values.length === 0}
            onClick={() => onValuesChange([])}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

insert into categories(name,emoji,sort_order) values ('Basque Cheesecake','🍰',1),('Matcha & Tea','🍵',2);
insert into products(category_id,name,emoji,price_satang,available,sort_order)
select id,'Original Cheesecake','🍰',5900,true,1 from categories where name='Basque Cheesecake';
insert into products(category_id,name,emoji,price_satang,available,sort_order)
select id,'Matcha Cheesecake','🍵',7900,true,2 from categories where name='Basque Cheesecake';
insert into products(category_id,name,emoji,price_satang,available,sort_order)
select id,'Red Velvet Cheesecake','❤️',6900,true,3 from categories where name='Basque Cheesecake';
-- Prices not explicitly mapped in the supplied menu are left unavailable until confirmed.
insert into products(category_id,name,emoji,price_satang,available,sort_order)
select id, v.name, v.emoji, v.price, v.available, v.pos from categories c cross join (values
 ('Matcha','🍵',0,false,1),('Clear Matcha','🧊',0,false,2),('Matcha Latte','🥛',0,false,3),
 ('Hojicha Latte','☕',0,false,4),('Apple Tea','🍎',0,false,5),('Peach Tea','🍑',0,false,6)
) as v(name,emoji,price,available,pos) where c.name='Matcha & Tea';
